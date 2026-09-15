/**
 * Integration coverage for unlimited invites (#637, ADR-0043 §5).
 *
 * The claims here are about the database: that an unlimited send writes
 * `spent = false` and leaves the balance alone while `canInvite` and
 * `canDownload` still hold in the claim, that every exit from `pending` — the
 * sweep, a re-invite, a staff cancel, a member withdraw — refunds only a spent
 * invite, and that a re-invite reads the OLD send's flag before it writes the
 * new one. The last is what stops grant → send → revoke → withdraw from minting
 * an invite.
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { createInvite, inviteSpendWhere } from '../modules/invite';
import { runInviteExpiryCycle } from '../modules/inviteExpiryJob';
import { cancelInvite, withdrawInvite } from '../modules/inviteControls';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const UNLIMITED = { unlimited: true };

let seq = 0;
const mkUser = async (
  opts: { inviteCount?: number; canDownload?: boolean; level?: number } = {}
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
      username: `it-unlimited-${seq}`,
      email: `it-unlimited-${seq}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      inviteCount: opts.inviteCount ?? 0,
      canDownload: opts.canDownload ?? true
    }
  });
};

const balance = async (id: number) =>
  (await testPrisma.user.findUniqueOrThrow({ where: { id } })).inviteCount;
const rowFor = (email: string) =>
  testPrisma.invite.findUniqueOrThrow({ where: { email } });
const lapse = (email: string) =>
  testPrisma.invite.update({
    where: { email },
    data: { expires: new Date(Date.now() - 1000) }
  });

describe('an unlimited send', () => {
  it('sends with no invites, spends nothing and records the invite as unspent', async () => {
    const member = await mkUser({ inviteCount: 0 });

    expect(
      await createInvite(member.id, 'a@example.com', '', UNLIMITED)
    ).toMatchObject({ ok: true });
    expect(await balance(member.id)).toBe(0);
    expect((await rowFor('a@example.com')).spent).toBe(false);
  });

  it('records an ordinary send as spent', async () => {
    const member = await mkUser({ inviteCount: 1 });

    await createInvite(member.id, 'a@example.com', '');

    expect(await balance(member.id)).toBe(0);
    expect((await rowFor('a@example.com')).spent).toBe(true);
  });

  it('is still refused when downloads are disabled', async () => {
    const member = await mkUser({ canDownload: false });

    expect(
      await createInvite(member.id, 'a@example.com', '', UNLIMITED)
    ).toEqual({ ok: false, reason: 'downloads_disabled' });
    expect(await testPrisma.invite.count()).toBe(0);
  });

  it('holds canDownload in the claim, but not the balance', async () => {
    const empty = await mkUser({ inviteCount: 0 });
    const disabled = await mkUser({ inviteCount: 0, canDownload: false });

    const claim = (id: number, unlimited: boolean) =>
      testPrisma.user.updateMany({
        where: { id, ...inviteSpendWhere(unlimited) },
        data: { inviteCount: { decrement: unlimited ? 0 : 1 } }
      });

    expect((await claim(empty.id, false)).count).toBe(0);
    expect((await claim(empty.id, true)).count).toBe(1);
    expect((await claim(disabled.id, true)).count).toBe(0);
    expect(await balance(empty.id)).toBe(0);
  });
});

describe('ending an unspent invite refunds nothing', () => {
  it('is not refunded by the sweep, while a spent one beside it is', async () => {
    await mkUser({ level: 1000 }); // the sweep's actor
    const unlimited = await mkUser({ inviteCount: 0 });
    const ordinary = await mkUser({ inviteCount: 1 });
    await createInvite(unlimited.id, 'free@example.com', '', UNLIMITED);
    await createInvite(ordinary.id, 'paid@example.com', '');
    await lapse('free@example.com');
    await lapse('paid@example.com');

    expect(await runInviteExpiryCycle()).toMatchObject({ expired: 2 });

    expect(await balance(unlimited.id)).toBe(0);
    expect(await balance(ordinary.id)).toBe(1);
    const audits = await testPrisma.auditLog.findMany({
      where: { action: 'invite.expired' },
      orderBy: { targetId: 'asc' }
    });
    expect(
      audits.map((a) => (a.metadata as { refunded: boolean }).refunded)
    ).toEqual([false, true]);
  });

  it('is not refunded by a withdraw, so grant → send → revoke → withdraw mints nothing', async () => {
    // The permission is gone by the time of the withdraw; the row still knows.
    const member = await mkUser({ inviteCount: 2 });
    await createInvite(member.id, 'a@example.com', '', UNLIMITED);
    const row = await rowFor('a@example.com');

    expect(await withdrawInvite(member.id, row.id)).toEqual({
      refunded: false
    });
    expect(await balance(member.id)).toBe(2);
  });

  it('is not refunded by a staff cancel', async () => {
    const staff = await mkUser({ level: 1000 });
    const member = await mkUser({ inviteCount: 0 });
    await createInvite(member.id, 'a@example.com', '', UNLIMITED);
    const row = await rowFor('a@example.com');

    expect(await cancelInvite(staff.id, row.id, { reason: 'test' })).toEqual({
      refunded: false
    });
    expect(await balance(member.id)).toBe(0);
  });
});

describe('a re-invite reads the old send before writing the new one', () => {
  it('refunds nobody for a lapsed unspent invite, and the new ordinary send pays', async () => {
    const unlimited = await mkUser({ inviteCount: 0 });
    const ordinary = await mkUser({ inviteCount: 1 });
    await createInvite(unlimited.id, 'a@example.com', '', UNLIMITED);
    await lapse('a@example.com');

    expect(await createInvite(ordinary.id, 'a@example.com', '')).toMatchObject({
      ok: true
    });

    expect(await balance(unlimited.id)).toBe(0);
    expect(await balance(ordinary.id)).toBe(0);
    expect(await rowFor('a@example.com')).toMatchObject({
      inviterId: ordinary.id,
      spent: true
    });
  });

  it('refunds the original sender of a lapsed spent invite, and the new unlimited send is unspent', async () => {
    const ordinary = await mkUser({ inviteCount: 1 });
    const unlimited = await mkUser({ inviteCount: 0 });
    await createInvite(ordinary.id, 'a@example.com', '');
    await lapse('a@example.com');

    expect(
      await createInvite(unlimited.id, 'a@example.com', '', UNLIMITED)
    ).toMatchObject({ ok: true });

    expect(await balance(ordinary.id)).toBe(1);
    expect(await balance(unlimited.id)).toBe(0);
    expect(await rowFor('a@example.com')).toMatchObject({
      inviterId: unlimited.id,
      spent: false
    });
  });

  it('does not let an own lapsed unspent invite pay for an ordinary resend', async () => {
    // The pre-check's self-refund exemption lets this reach the write; the
    // refund pays nothing, so the spend refuses and the whole write rolls back.
    const member = await mkUser({ inviteCount: 0 });
    await createInvite(member.id, 'a@example.com', '', UNLIMITED);
    await lapse('a@example.com');

    expect(await createInvite(member.id, 'a@example.com', '')).toEqual({
      ok: false,
      reason: 'no_invites'
    });
    expect((await rowFor('a@example.com')).status).toBe('pending');
    expect(await balance(member.id)).toBe(0);
  });
});
