/**
 * Integration coverage for the invite lifecycle (#627, ADR-0041).
 *
 * The claims here are about the database, which a mocked Prisma cannot vouch
 * for: that the claim's relation filter (`inviter.disabled`) really works in an
 * `updateMany`, that a refund happens exactly once when two writers race for
 * the same transition, and that a reused row keeps `email @unique` intact.
 */
import {
  truncateAll,
  seedDefaults,
  testPrisma,
  openRegistration
} from '../test/dbHelpers';
import { runInviteExpiryCycle } from '../modules/inviteExpiryJob';
import { createInvite } from '../modules/invite';
import { registerUser } from '../modules/auth';
import { DAY_MS } from '../modules/inviteGrant';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
  // DEFAULTS is `closed`; createInvite reads it (#673).
  await openRegistration();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;
const mkUser = async (
  opts: { level?: number; inviteCount?: number; disabled?: boolean } = {}
) => {
  seq += 1;
  const level = opts.level ?? 100;
  const rank =
    (await testPrisma.userRank.findFirst({ where: { level } })) ??
    (await testPrisma.userRank.create({
      data: { level, name: `rank-${level}`, permissions: {} }
    }));
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `it-invite-${seq}`,
      email: `it-invite-${seq}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      inviteCount: opts.inviteCount ?? 0,
      disabled: opts.disabled ?? false
    }
  });
};

const mkInvite = (
  inviterId: number,
  email: string,
  opts: { expiresInMs?: number; status?: 'pending' | 'accepted' } = {}
) =>
  testPrisma.invite.create({
    data: {
      inviterId,
      email,
      inviteKey: `key-${email}`,
      expires: new Date(Date.now() + (opts.expiresInMs ?? DAY_MS)),
      status: opts.status ?? 'pending'
    }
  });

const balance = async (id: number) =>
  (await testPrisma.user.findUniqueOrThrow({ where: { id } })).inviteCount;
const statusOf = async (email: string) =>
  (await testPrisma.invite.findUniqueOrThrow({ where: { email } })).status;
const pmsTo = (userId: number) =>
  testPrisma.privateConversationParticipant.count({ where: { userId } });
const expiryAudits = () =>
  testPrisma.auditLog.count({ where: { action: 'invite.expired' } });

describe('runInviteExpiryCycle', () => {
  it('expires and refunds a past-due invite, and leaves live and accepted ones alone', async () => {
    await mkUser({ level: 1000 });
    const inviter = await mkUser({ inviteCount: 0 });
    await mkInvite(inviter.id, 'lapsed@example.com', { expiresInMs: -1000 });
    await mkInvite(inviter.id, 'live@example.com');
    await mkInvite(inviter.id, 'used@example.com', {
      expiresInMs: -1000,
      status: 'accepted'
    });

    const tally = await runInviteExpiryCycle();

    expect(tally).toEqual({ expired: 1, failed: 0 });
    expect(await statusOf('lapsed@example.com')).toBe('expired');
    expect(await statusOf('live@example.com')).toBe('pending');
    expect(await statusOf('used@example.com')).toBe('accepted');
    // Rank cap defaults to 0: the refund is not clamped to it.
    expect(await balance(inviter.id)).toBe(1);
    expect(await pmsTo(inviter.id)).toBe(1);
    expect(await expiryAudits()).toBe(1);
  });

  it('expires a live-dated invite whose inviter is disabled, refunds it, and sends no PM', async () => {
    await mkUser({ level: 1000 });
    const inviter = await mkUser({ inviteCount: 2, disabled: true });
    await mkInvite(inviter.id, 'orphaned@example.com');

    await runInviteExpiryCycle();

    expect(await statusOf('orphaned@example.com')).toBe('expired');
    expect(await balance(inviter.id)).toBe(3);
    expect(await pmsTo(inviter.id)).toBe(0);
  });

  it('refunds exactly once when two sweeps race for the same invites', async () => {
    await mkUser({ level: 1000 });
    const inviter = await mkUser();
    for (let i = 0; i < 10; i += 1) {
      await mkInvite(inviter.id, `race${i}@example.com`, {
        expiresInMs: -1000
      });
    }

    const [a, b] = await Promise.all([
      runInviteExpiryCycle(),
      runInviteExpiryCycle()
    ]);

    expect(a.expired + b.expired).toBe(10);
    expect(await balance(inviter.id)).toBe(10);
    expect(await expiryAudits()).toBe(10);
  });

  it('skips the cycle when there is no SysOp to attribute it to', async () => {
    const inviter = await mkUser();
    await mkInvite(inviter.id, 'lapsed@example.com', { expiresInMs: -1000 });

    expect(await runInviteExpiryCycle()).toEqual({ expired: 0, failed: 0 });
    expect(await statusOf('lapsed@example.com')).toBe('pending');
  });
});

describe('createInvite on an address that already has a row', () => {
  it('refuses a live invite and writes nothing', async () => {
    const first = await mkUser();
    const second = await mkUser({ inviteCount: 1 });
    await mkInvite(first.id, 'taken@example.com');

    const result = await createInvite(second.id, 'taken@example.com', '');

    expect(result).toEqual({ ok: false, reason: 'already_invited' });
    expect(await balance(second.id)).toBe(1);
  });

  it('refuses an accepted invite: the address was used, not lapsed', async () => {
    const first = await mkUser();
    const second = await mkUser({ inviteCount: 1 });
    await mkInvite(first.id, 'joined@example.com', {
      expiresInMs: -1000,
      status: 'accepted'
    });

    expect(await createInvite(second.id, 'joined@example.com', '')).toEqual({
      ok: false,
      reason: 'already_invited'
    });
  });

  it('expires an unswept lapsed invite, refunds its inviter, and reuses the row', async () => {
    const original = await mkUser({ inviteCount: 0 });
    const next = await mkUser({ inviteCount: 1 });
    const old = await mkInvite(original.id, 'again@example.com', {
      expiresInMs: -1000
    });

    const result = await createInvite(next.id, 'again@example.com', 'hi');

    expect(result).toMatchObject({ ok: true });
    const row = await testPrisma.invite.findUniqueOrThrow({
      where: { email: 'again@example.com' }
    });
    expect(row.id).toBe(old.id);
    expect(row.status).toBe('pending');
    expect(row.inviterId).toBe(next.id);
    expect(row.inviteKey).not.toBe(old.inviteKey);
    expect(row.expires.getTime()).toBeGreaterThan(Date.now() + 2 * DAY_MS);
    expect(await balance(original.id)).toBe(1);
    expect(await balance(next.id)).toBe(0);
    expect(await pmsTo(original.id)).toBe(1);
    expect(await expiryAudits()).toBe(1);
  });

  it('does not refund twice when the row was already swept', async () => {
    await mkUser({ level: 1000 });
    const original = await mkUser({ inviteCount: 0 });
    const next = await mkUser({ inviteCount: 1 });
    await mkInvite(original.id, 'swept@example.com', { expiresInMs: -1000 });
    await runInviteExpiryCycle();

    await createInvite(next.id, 'swept@example.com', '');

    expect(await balance(original.id)).toBe(1);
    expect(await expiryAudits()).toBe(1);
  });

  it('sends no PM when a member re-invites their own lapsed address, and nets their balance to zero', async () => {
    const member = await mkUser({ inviteCount: 0 });
    await mkInvite(member.id, 'mine@example.com', { expiresInMs: -1000 });

    // Balance 0: the refund inside the same transaction is what pays the send.
    const result = await createInvite(member.id, 'mine@example.com', '');

    expect(result).toMatchObject({ ok: true });
    expect(await balance(member.id)).toBe(0);
    expect(await pmsTo(member.id)).toBe(0);
  });

  it('rolls the expiry back when the new inviter cannot pay', async () => {
    const original = await mkUser({ inviteCount: 0 });
    const broke = await mkUser({ inviteCount: 0 });
    await mkInvite(original.id, 'lapsed@example.com', { expiresInMs: -1000 });

    const result = await createInvite(broke.id, 'lapsed@example.com', '');

    expect(result).toEqual({ ok: false, reason: 'no_invites' });
    expect(await statusOf('lapsed@example.com')).toBe('pending');
    expect(await balance(original.id)).toBe(0);
    expect(await pmsTo(original.id)).toBe(0);
  });

  it('refunds exactly once when the sweep and a re-invite race', async () => {
    await mkUser({ level: 1000 });
    const original = await mkUser({ inviteCount: 0 });
    const next = await mkUser({ inviteCount: 1 });
    await mkInvite(original.id, 'contested@example.com', {
      expiresInMs: -1000
    });

    await Promise.all([
      runInviteExpiryCycle(),
      createInvite(next.id, 'contested@example.com', '')
    ]);

    expect(await balance(original.id)).toBe(1);
    expect(await expiryAudits()).toBe(1);
  });
});

describe('registerUser with an invite', () => {
  const register = (inviteKey: string, email: string) =>
    registerUser({
      username: `joiner-${email.split('@')[0]}`,
      email,
      password: 'password1',
      registrationMode: 'invite',
      maxUsers: 7000,
      inviteKey
    });

  it('accepts a live invite', async () => {
    const inviter = await mkUser();
    await mkInvite(inviter.id, 'fresh@example.com');

    expect(
      (await register('key-fresh@example.com', 'fresh@example.com')).ok
    ).toBe(true);
    expect(await statusOf('fresh@example.com')).toBe('accepted');
  });

  it('refuses an unswept past-due invite as expired, and creates no user', async () => {
    const inviter = await mkUser();
    await mkInvite(inviter.id, 'late@example.com', { expiresInMs: -1000 });

    expect(await register('key-late@example.com', 'late@example.com')).toEqual({
      ok: false,
      reason: 'invite_expired'
    });
    expect(
      await testPrisma.user.count({ where: { email: 'late@example.com' } })
    ).toBe(0);
  });

  it('refuses an invite from a disabled inviter as expired, before and after the sweep', async () => {
    await mkUser({ level: 1000 });
    const inviter = await mkUser({ disabled: true });
    await mkInvite(inviter.id, 'orphan@example.com');

    const before = await register(
      'key-orphan@example.com',
      'orphan@example.com'
    );
    await runInviteExpiryCycle();
    const after = await register(
      'key-orphan@example.com',
      'orphan@example.com'
    );

    // The same answer both times, so the sweep reveals nothing.
    expect(before).toEqual({ ok: false, reason: 'invite_expired' });
    expect(after).toEqual(before);
  });
});
