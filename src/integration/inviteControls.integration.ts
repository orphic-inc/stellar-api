/**
 * Integration coverage for staff invite controls (#636), and a member's own
 * pending list and withdraw (#640), which share the cancel's claim.
 *
 * The claims here are about the database, which a mocked Prisma cannot vouch
 * for: that `canInvite` really reaches the lapse rule's relation filter and the
 * send's conditional spend, that the count edit's compare-and-set refuses
 * rather than erasing a refund that landed after the caller read the count, and
 * that a cancel and the sweep never both refund the same invite. For #640: that
 * a withdraw reaches only the caller's own invites, and that a cancelled address
 * stays taken until its original expiry.
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { runInviteExpiryCycle } from '../modules/inviteExpiryJob';
import { createInvite, listOwnPendingInvites } from '../modules/invite';
import { registerUser } from '../modules/auth';
import {
  setCanInvite,
  setInviteCount,
  cancelInvite,
  withdrawInvite
} from '../modules/inviteControls';
import { DAY_MS } from '../modules/inviteGrant';
import { reusableInviteWhere } from '../modules/inviteExpiry';

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

describe('cancelInvite', () => {
  const cancel = (actorId: number, inviteId: number) =>
    cancelInvite(actorId, inviteId, { reason: 'test' });
  const cancelAudits = () =>
    testPrisma.auditLog.count({ where: { action: 'invite.cancelled' } });

  it('cancels a pending invite and refunds its inviter, past the rank cap', async () => {
    const staff = await mkUser({ level: 1000 });
    const inviter = await mkUser({ inviteCount: 0 });
    const invite = await mkInvite(inviter.id, 'typo@example.com');

    await cancel(staff.id, invite.id);

    expect(await statusOf('typo@example.com')).toBe('cancelled');
    expect(await balance(inviter.id)).toBe(1);
    expect(await cancelAudits()).toBe(1);
  });

  it('answers 409 on a second cancel, and refunds only once', async () => {
    const staff = await mkUser({ level: 1000 });
    const inviter = await mkUser({ inviteCount: 0 });
    const invite = await mkInvite(inviter.id, 'twice@example.com');

    await cancel(staff.id, invite.id);
    await expect(cancel(staff.id, invite.id)).rejects.toMatchObject({
      statusCode: 409
    });

    expect(await balance(inviter.id)).toBe(1);
    expect(await cancelAudits()).toBe(1);
  });

  it('answers 409 for an accepted invite, and 404 for no invite', async () => {
    const staff = await mkUser({ level: 1000 });
    const inviter = await mkUser({ inviteCount: 0 });
    const used = await mkInvite(inviter.id, 'joined@example.com', {
      status: 'accepted'
    });

    await expect(cancel(staff.id, used.id)).rejects.toMatchObject({
      statusCode: 409
    });
    await expect(cancel(staff.id, 999_999)).rejects.toMatchObject({
      statusCode: 404
    });
    expect(await balance(inviter.id)).toBe(0);
  });

  it('refuses to cancel an invite the sweep already expired, so it is not refunded twice', async () => {
    const staff = await mkUser({ level: 1000 });
    const inviter = await mkUser({ inviteCount: 0 });
    const invite = await mkInvite(inviter.id, 'swept@example.com', {
      expiresInMs: -1000
    });
    await runInviteExpiryCycle();

    await expect(cancel(staff.id, invite.id)).rejects.toMatchObject({
      statusCode: 409
    });
    expect(await statusOf('swept@example.com')).toBe('expired');
    expect(await balance(inviter.id)).toBe(1);
  });

  it('cancels a past-due invite the sweep has not reached, and the sweep then leaves it alone', async () => {
    const staff = await mkUser({ level: 1000 });
    const inviter = await mkUser({ inviteCount: 0 });
    const invite = await mkInvite(inviter.id, 'unswept@example.com', {
      expiresInMs: -1000
    });

    await cancel(staff.id, invite.id);
    await runInviteExpiryCycle();

    expect(await statusOf('unswept@example.com')).toBe('cancelled');
    expect(await balance(inviter.id)).toBe(1);
  });

  it('answers the key holder invite_expired, and holds the address until the original expiry (#640)', async () => {
    const staff = await mkUser({ level: 1000 });
    const inviter = await mkUser({ inviteCount: 0 });
    const other = await mkUser({ inviteCount: 1 });
    const invite = await mkInvite(inviter.id, 'holder@example.com');
    await cancel(staff.id, invite.id);

    const registered = await registerUser({
      username: 'holder',
      email: 'holder@example.com',
      password: 'password1',
      registrationMode: 'invite',
      maxUsers: 7000,
      inviteKey: 'key-holder@example.com'
    });
    const tooSoon = await createInvite(other.id, 'holder@example.com', '');
    await testPrisma.invite.update({
      where: { id: invite.id },
      data: { expires: new Date(Date.now() - 1000) }
    });
    const afterExpiry = await createInvite(other.id, 'holder@example.com', '');

    expect(registered).toEqual({ ok: false, reason: 'invite_expired' });
    expect(tooSoon).toEqual({ ok: false, reason: 'already_invited' });
    expect(afterExpiry).toMatchObject({ ok: true });
    const row = await testPrisma.invite.findUniqueOrThrow({
      where: { email: 'holder@example.com' }
    });
    expect(row).toMatchObject({
      id: invite.id,
      status: 'pending',
      inviterId: other.id
    });
    // The re-invite does not refund the original inviter a second time.
    expect(await balance(inviter.id)).toBe(1);
  });
});

describe('a member withdrawing their own invite (#640)', () => {
  const page = { page: 1, limit: 25, skip: 0 };

  it('lists only their own invites that can still be used, soonest first', async () => {
    const member = await mkUser();
    const other = await mkUser();
    await mkInvite(member.id, 'later@example.com', { expiresInMs: 2 * DAY_MS });
    await mkInvite(member.id, 'sooner@example.com', { expiresInMs: DAY_MS });
    await mkInvite(member.id, 'lapsed@example.com', { expiresInMs: -1000 });
    await mkInvite(other.id, 'theirs@example.com');
    const withdrawn = await mkInvite(member.id, 'withdrawn@example.com');
    await withdrawInvite(member.id, withdrawn.id);

    const { rows, total } = await listOwnPendingInvites(member.id, page);

    expect(total).toBe(2);
    expect(rows.map((r) => r.email)).toEqual([
      'sooner@example.com',
      'later@example.com'
    ]);
  });

  it('lists nothing for a revoked member, whose invites have all lapsed', async () => {
    const member = await mkUser({ canInvite: false });
    await mkInvite(member.id, 'held@example.com');

    expect(await listOwnPendingInvites(member.id, page)).toEqual({
      rows: [],
      total: 0
    });
  });

  it('withdraws and refunds their own invite, audited as the inviter', async () => {
    const member = await mkUser({ inviteCount: 0 });
    const invite = await mkInvite(member.id, 'typo@example.con');

    await withdrawInvite(member.id, invite.id);

    expect(await statusOf('typo@example.con')).toBe('cancelled');
    expect(await balance(member.id)).toBe(1);
    const row = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: 'invite.cancelled' }
    });
    expect(row.actorId).toBe(member.id);
    expect(row.metadata).toMatchObject({ by: 'inviter', refunded: true });
    expect(await pmsTo(member.id)).toBe(0);
  });

  it("answers 404 for another member's invite and changes nothing", async () => {
    const member = await mkUser({ inviteCount: 0 });
    const owner = await mkUser({ inviteCount: 0 });
    const invite = await mkInvite(owner.id, 'theirs@example.com');

    await expect(withdrawInvite(member.id, invite.id)).rejects.toMatchObject({
      statusCode: 404
    });
    expect(await statusOf('theirs@example.com')).toBe('pending');
    expect(await balance(owner.id)).toBe(0);
    expect(await balance(member.id)).toBe(0);
  });

  it('answers 409 for their own invite once accepted', async () => {
    const member = await mkUser({ inviteCount: 0 });
    const invite = await mkInvite(member.id, 'joined@example.com', {
      status: 'accepted'
    });

    await expect(withdrawInvite(member.id, invite.id)).rejects.toMatchObject({
      statusCode: 409
    });
    expect(await balance(member.id)).toBe(0);
  });

  it('lets a revoked member withdraw, refunding into their inert balance', async () => {
    const member = await mkUser({ inviteCount: 0, canInvite: false });
    const invite = await mkInvite(member.id, 'held@example.com');

    await withdrawInvite(member.id, invite.id);

    expect(await balance(member.id)).toBe(1);
  });

  it('holds a cancelled row in the reuse claim itself, not only in the pre-check', async () => {
    // The pre-check (`isAddressFree`) reads before the transaction; this
    // predicate is what still refuses when the two race. Tested on its own
    // because either guard alone hides the other from the tests below.
    const member = await mkUser();
    const live = await mkInvite(member.id, 'held@example.com');
    const due = await mkInvite(member.id, 'due@example.com', {
      expiresInMs: -1000
    });
    await testPrisma.invite.updateMany({
      where: { id: { in: [live.id, due.id] } },
      data: { status: 'cancelled' }
    });

    const claim = (id: number) =>
      testPrisma.invite.updateMany({
        where: { id, ...reusableInviteWhere(new Date()) },
        data: { status: 'pending' }
      });

    expect((await claim(live.id)).count).toBe(0);
    expect((await claim(due.id)).count).toBe(1);
  });

  it('cannot mail one address again by sending, withdrawing and resending', async () => {
    const member = await mkUser({ inviteCount: 1 });
    const sent = await createInvite(member.id, 'target@example.com', '');
    expect(sent).toMatchObject({ ok: true });
    const row = await testPrisma.invite.findUniqueOrThrow({
      where: { email: 'target@example.com' }
    });

    await withdrawInvite(member.id, row.id);
    const resent = await createInvite(member.id, 'target@example.com', '');

    expect(resent).toEqual({ ok: false, reason: 'already_invited' });
    // The refund stands, so the member lost nothing by fixing a mistake.
    expect(await balance(member.id)).toBe(1);
    expect(
      await createInvite(member.id, 'corrected@example.com', '')
    ).toMatchObject({ ok: true });
  });
});
