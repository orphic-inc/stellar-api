/**
 * Integration coverage for staff invite controls (#636).
 *
 * The claims here are about the database, which a mocked Prisma cannot vouch
 * for: that `canInvite` really reaches the lapse rule's relation filter and the
 * send's conditional spend, and that the count edit's compare-and-set refuses
 * rather than erasing a refund that landed after the caller read the count.
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { runInviteExpiryCycle } from '../modules/inviteExpiryJob';
import { createInvite } from '../modules/invite';
import { registerUser } from '../modules/auth';
import { setCanInvite, setInviteCount } from '../modules/inviteControls';
import { DAY_MS } from '../modules/inviteGrant';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;
const mkUser = async (
  opts: { level?: number; inviteCount?: number; canInvite?: boolean } = {}
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
      username: `it-controls-${seq}`,
      email: `it-controls-${seq}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      inviteCount: opts.inviteCount ?? 0,
      canInvite: opts.canInvite ?? true
    }
  });
};

const mkInvite = (
  inviterId: number,
  email: string,
  opts: { expiresInMs?: number } = {}
) =>
  testPrisma.invite.create({
    data: {
      inviterId,
      email,
      inviteKey: `key-${email}`,
      expires: new Date(Date.now() + (opts.expiresInMs ?? DAY_MS))
    }
  });

const balance = async (id: number) =>
  (await testPrisma.user.findUniqueOrThrow({ where: { id } })).inviteCount;
const statusOf = async (email: string) =>
  (await testPrisma.invite.findUniqueOrThrow({ where: { email } })).status;
const pmsTo = (userId: number) =>
  testPrisma.privateConversationParticipant.count({ where: { userId } });

const revoke = (actorId: number, userId: number) =>
  setCanInvite(actorId, userId, { canInvite: false, reason: 'test' });

describe('revoking invite privileges', () => {
  it('keeps the balance and records it in the audit row', async () => {
    const staff = await mkUser({ level: 1000 });
    const member = await mkUser({ inviteCount: 4 });

    await revoke(staff.id, member.id);

    const after = await testPrisma.user.findUniqueOrThrow({
      where: { id: member.id }
    });
    expect(after).toMatchObject({ canInvite: false, inviteCount: 4 });
    const row = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: 'user.can_invite_changed' }
    });
    expect(row.metadata).toMatchObject({ canInvite: false, inviteCount: 4 });
  });

  it('answers 404 for a member who does not exist', async () => {
    const staff = await mkUser({ level: 1000 });
    await expect(revoke(staff.id, 999_999)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('lapses a live-dated pending invite, which the sweep refunds without a PM', async () => {
    const staff = await mkUser({ level: 1000 });
    const member = await mkUser({ inviteCount: 0 });
    await mkInvite(member.id, 'pending@example.com');

    await revoke(staff.id, member.id);
    await runInviteExpiryCycle();

    expect(await statusOf('pending@example.com')).toBe('expired');
    expect(await balance(member.id)).toBe(1);
    // "You can invite that address again" would be false while revoked.
    expect(await pmsTo(member.id)).toBe(0);
  });

  it('frees the address for another member, refunding the revoked inviter without a PM', async () => {
    const revoked = await mkUser({ inviteCount: 0, canInvite: false });
    const other = await mkUser({ inviteCount: 1 });
    await mkInvite(revoked.id, 'freed@example.com');

    const result = await createInvite(other.id, 'freed@example.com', '');

    expect(result).toMatchObject({ ok: true });
    expect(await balance(revoked.id)).toBe(1);
    expect(await pmsTo(revoked.id)).toBe(0);
  });

  it('refuses the key at registration as expired, before and after the sweep', async () => {
    await mkUser({ level: 1000 });
    const revoked = await mkUser({ canInvite: false });
    await mkInvite(revoked.id, 'holder@example.com');
    const register = () =>
      registerUser({
        username: 'holder',
        email: 'holder@example.com',
        password: 'password1',
        registrationMode: 'invite',
        maxUsers: 7000,
        inviteKey: 'key-holder@example.com'
      });

    const before = await register();
    await runInviteExpiryCycle();
    const after = await register();

    expect(before).toEqual({ ok: false, reason: 'invite_expired' });
    expect(after).toEqual(before);
  });
});

describe('createInvite from a revoked member', () => {
  it('refuses with invites_revoked, spends nothing and writes no invite', async () => {
    const member = await mkUser({ inviteCount: 3, canInvite: false });

    const result = await createInvite(member.id, 'nope@example.com', '');

    expect(result).toEqual({ ok: false, reason: 'invites_revoked' });
    expect(await balance(member.id)).toBe(3);
    expect(await testPrisma.invite.count()).toBe(0);
  });

  it('names the revoke rather than the balance when both would refuse', async () => {
    const member = await mkUser({ inviteCount: 0, canInvite: false });

    expect(await createInvite(member.id, 'nope@example.com', '')).toEqual({
      ok: false,
      reason: 'invites_revoked'
    });
  });

  it('sends again once restored', async () => {
    const staff = await mkUser({ level: 1000 });
    const member = await mkUser({ inviteCount: 1, canInvite: false });

    await setCanInvite(staff.id, member.id, { canInvite: true, reason: 'ok' });

    expect(
      await createInvite(member.id, 'welcome@example.com', '')
    ).toMatchObject({ ok: true });
    expect(await balance(member.id)).toBe(0);
  });
});

describe('setInviteCount', () => {
  const edit = (actorId: number, userId: number, from: number, to: number) =>
    setInviteCount(actorId, userId, {
      inviteCount: to,
      expectedInviteCount: from,
      reason: 'test'
    });

  it('sets the count, past the rank cap, and audits from and to', async () => {
    const staff = await mkUser({ level: 1000 });
    const member = await mkUser({ inviteCount: 2 });

    await edit(staff.id, member.id, 2, 40);

    expect(await balance(member.id)).toBe(40);
    const row = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: 'user.invite_count_changed' }
    });
    expect(row.metadata).toMatchObject({ from: 2, to: 40 });
  });

  it('refuses an edit made before a refund landed, rather than erasing the refund', async () => {
    const staff = await mkUser({ level: 1000 });
    const member = await mkUser({ inviteCount: 2 });
    await mkInvite(member.id, 'refund@example.com', { expiresInMs: -1000 });
    // Staff loaded the form at 2; the sweep refunds one before they save.
    await runInviteExpiryCycle();

    await expect(edit(staff.id, member.id, 2, 10)).rejects.toMatchObject({
      statusCode: 409
    });
    expect(await balance(member.id)).toBe(3);
    expect(
      await testPrisma.auditLog.count({
        where: { action: 'user.invite_count_changed' }
      })
    ).toBe(0);
  });
});
