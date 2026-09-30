/**
 * The staff note on an invite, carried to the invitee at registration (#851,
 * grilled on #638).
 *
 * The note becomes a `UserModerationNote` in the registration transaction, and
 * only when the inviter holds `invites_note` at that moment. The migration that
 * grants `invites_note` is exercised by running its own SQL, so what is tested
 * is exactly what ships.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { registerUser } from '../modules/auth';

const GRANT_SQL = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20261001120000_invites_note_permission/migration.sql'
  ),
  'utf8'
);

const DAY = 86_400_000;

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;

const mkRank = (permissions: Record<string, boolean>) => {
  seq += 1;
  return testPrisma.userRank.create({
    data: { level: 300 + seq, name: `Rank ${seq}`, permissions }
  });
};

/** A member registered openly, then moved onto a rank with `permissions`. */
const mkInviter = async (permissions: Record<string, boolean>) => {
  seq += 1;
  const r = await registerUser({
    username: `inviter${seq}`,
    email: `inviter${seq}@example.com`,
    password: 'password1',
    registrationMode: 'open',
    maxUsers: 7000
  });
  if (!r.ok) throw new Error('fixture registration failed');
  const rank = await mkRank(permissions);
  await testPrisma.user.update({
    where: { id: r.user.id },
    data: { userRankId: rank.id }
  });
  return r.user.id;
};

/** Register `email` through a pending invite from `inviterId` carrying `reason`. */
const joinWith = async (inviterId: number, reason: string) => {
  seq += 1;
  const email = `joiner${seq}@example.com`;
  await testPrisma.invite.create({
    data: {
      inviterId,
      inviteKey: `key${seq}`,
      email,
      reason,
      expires: new Date(Date.now() + DAY)
    }
  });
  const r = await registerUser({
    username: `joiner${seq}`,
    email,
    password: 'password1',
    registrationMode: 'invite',
    maxUsers: 7000,
    inviteKey: `key${seq}`
  });
  if (!r.ok) throw new Error(`registration refused: ${r.reason}`);
  return r.user.id;
};

const notesOn = (userId: number) =>
  testPrisma.userModerationNote.findMany({
    where: { userId },
    select: { authorId: true, body: true }
  });

describe('carrying the invite note at registration (#851)', () => {
  it("carries a holder's note once, authored by the inviter", async () => {
    const inviterId = await mkInviter({ invites_note: true });

    const joinerId = await joinWith(inviterId, '  Known from the forum  ');

    expect(await notesOn(joinerId)).toEqual([
      { authorId: inviterId, body: 'Invite note: Known from the forum' }
    ]);
  });

  it('carries nothing when the inviter does not hold invites_note', async () => {
    // A note written before the gate, when any member could write one.
    const inviterId = await mkInviter({});

    const joinerId = await joinWith(inviterId, 'my mate');

    expect(await notesOn(joinerId)).toEqual([]);
  });

  it('carries nothing when the inviter lost invites_note after sending', async () => {
    const inviterId = await mkInviter({ invites_note: true });
    const demoted = await mkRank({});
    const email = 'late@example.com';
    await testPrisma.invite.create({
      data: {
        inviterId,
        inviteKey: 'late',
        email,
        reason: 'vouched for',
        expires: new Date(Date.now() + DAY)
      }
    });
    await testPrisma.user.update({
      where: { id: inviterId },
      data: { userRankId: demoted.id }
    });

    const r = await registerUser({
      username: 'late',
      email,
      password: 'password1',
      registrationMode: 'invite',
      maxUsers: 7000,
      inviteKey: 'late'
    });
    if (!r.ok) throw new Error(`registration refused: ${r.reason}`);

    expect(await notesOn(r.user.id)).toEqual([]);
  });

  it('creates no note for an empty reason', async () => {
    const inviterId = await mkInviter({ invites_note: true });

    const joinerId = await joinWith(inviterId, '   ');

    expect(await notesOn(joinerId)).toEqual([]);
  });

  it('honours invites_note held through a secondary rank', async () => {
    const inviterId = await mkInviter({});
    const noteRank = await mkRank({ invites_note: true });
    await testPrisma.userSecondaryRank.create({
      data: { userId: inviterId, userRankId: noteRank.id }
    });

    const joinerId = await joinWith(inviterId, 'staff vouch');

    expect(await notesOn(joinerId)).toEqual([
      { authorId: inviterId, body: 'Invite note: staff vouch' }
    ]);
  });
});

describe('the invites_note grant migration (#851)', () => {
  it('grants invites_note to every rank holding invites_manage, and no other', async () => {
    const manager = await mkRank({ invites_manage: true, forums_read: true });
    const member = await mkRank({ forums_read: true });
    const revoked = await mkRank({ invites_manage: false });

    await testPrisma.$executeRawUnsafe(GRANT_SQL);

    const permsOf = async (id: number) =>
      (await testPrisma.userRank.findUniqueOrThrow({ where: { id } }))
        .permissions;
    expect(await permsOf(manager.id)).toEqual({
      invites_manage: true,
      forums_read: true,
      invites_note: true
    });
    expect(await permsOf(member.id)).toEqual({ forums_read: true });
    expect(await permsOf(revoked.id)).toEqual({ invites_manage: false });
  });
});
