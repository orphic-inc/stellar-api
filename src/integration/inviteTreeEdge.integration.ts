/**
 * Integration coverage for #633 / ADR-0042: every account has an InviteTree
 * row, registration records the inviter, and the migration's backfill recovers
 * genealogy for accounts that predate it.
 *
 * The backfill is exercised by running the migration's own SQL against seeded
 * rows, so what is tested is exactly what ships.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { registerUser } from '../modules/auth';
import { createUser, getInviteTree } from '../modules/user';
import { seedSystemUser } from '../modules/bootstrap';

const BACKFILL_SQL = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260914200000_invite_tree_every_account/migration.sql'
  ),
  'utf8'
);

const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const rowOf = (userId: number) =>
  testPrisma.inviteTree.findUnique({ where: { userId } });

let inviterSeq = 0;
/** A member who can send invites. Registered openly, so their own edge is null. */
const mkInviter = async (): Promise<number> => {
  inviterSeq += 1;
  const r = await registerUser({
    username: `inviter${inviterSeq}`,
    email: `inviter${inviterSeq}@example.com`,
    password: 'password1',
    registrationMode: 'open',
    maxUsers: 7000
  });
  if (!r.ok) throw new Error('fixture registration failed');
  return r.user.id;
};

const mkInvite = (
  inviterId: number,
  inviteKey: string,
  email: string,
  expiresInMs: number
) =>
  testPrisma.invite.create({
    data: {
      inviterId,
      inviteKey,
      email,
      expires: new Date(Date.now() + expiresInMs)
    }
  });

describe('account creation writes the row', () => {
  it('records the inviter when a member registers through an invite', async () => {
    const inviter = await registerUser({
      username: 'inviter',
      email: 'inviter@example.com',
      password: 'password1',
      registrationMode: 'open',
      maxUsers: 7000
    });
    if (!inviter.ok) throw new Error('fixture registration failed');
    await testPrisma.invite.create({
      data: {
        inviterId: inviter.user.id,
        inviteKey: 'k1',
        email: 'joiner@example.com',
        expires: new Date(Date.now() + DAY)
      }
    });

    const joiner = await registerUser({
      username: 'joiner',
      email: 'joiner@example.com',
      password: 'password1',
      registrationMode: 'invite',
      maxUsers: 7000,
      inviteKey: 'k1'
    });
    if (!joiner.ok) throw new Error('invite registration failed');

    expect((await rowOf(joiner.user.id))?.inviterId).toBe(inviter.user.id);
    expect((await rowOf(inviter.user.id))?.inviterId).toBeNull();
  });

  // #675. An open site used to ignore a presented key entirely: the invite
  // was spent, the account got a null edge, and the invite lapsed. Two members
  // believed an invitation had happened and the tree recorded none of it.
  it('records the inviter on an OPEN site too, and consumes the invite', async () => {
    const inviter = await mkInviter();
    await mkInvite(inviter, 'k1', 'joiner@example.com', DAY);

    const joiner = await registerUser({
      username: 'joiner',
      email: 'joiner@example.com',
      password: 'password1',
      registrationMode: 'open',
      maxUsers: 7000,
      inviteKey: 'k1'
    });
    if (!joiner.ok) throw new Error('open registration failed');

    expect((await rowOf(joiner.user.id))?.inviterId).toBe(inviter);
    expect(
      (
        await testPrisma.invite.findUniqueOrThrow({
          where: { inviteKey: 'k1' }
        })
      ).status
    ).toBe('accepted');
  });

  // The key is not the gate on an open site, so a bad one must never refuse a
  // registration the site would have accepted with no key at all. Each of
  // these succeeds, with no edge.
  it.each([
    ['an unknown key', 'nosuchkey', 'joiner@example.com'],
    ['a key issued to somebody else', 'k1', 'stranger@example.com']
  ])('registers despite %s, without an edge', async (_label, key, email) => {
    const inviter = await mkInviter();
    await mkInvite(inviter, 'k1', 'joiner@example.com', DAY);

    const joiner = await registerUser({
      username: 'joiner',
      email,
      password: 'password1',
      registrationMode: 'open',
      maxUsers: 7000,
      inviteKey: key
    });
    if (!joiner.ok) throw new Error('open registration was refused');

    expect((await rowOf(joiner.user.id))?.inviterId).toBeNull();
  });

  it('registers despite a lapsed key on an open site, without an edge', async () => {
    const inviter = await mkInviter();
    await mkInvite(inviter, 'k1', 'joiner@example.com', -1000);

    const joiner = await registerUser({
      username: 'joiner',
      email: 'joiner@example.com',
      password: 'password1',
      registrationMode: 'open',
      maxUsers: 7000,
      inviteKey: 'k1'
    });
    if (!joiner.ok) throw new Error('open registration was refused');

    expect((await rowOf(joiner.user.id))?.inviterId).toBeNull();
    // Untouched, so the sweep still refunds it (ADR-0041).
    expect(
      (
        await testPrisma.invite.findUniqueOrThrow({
          where: { inviteKey: 'k1' }
        })
      ).status
    ).toBe('pending');
  });

  // An invite mode registration still refuses a lapsed key outright: there the
  // key IS the gate, and #675 changes nothing about that.
  it('still refuses a lapsed key in invite mode', async () => {
    const inviter = await mkInviter();
    await mkInvite(inviter, 'k1', 'joiner@example.com', -1000);

    const result = await registerUser({
      username: 'joiner',
      email: 'joiner@example.com',
      password: 'password1',
      registrationMode: 'invite',
      maxUsers: 7000,
      inviteKey: 'k1'
    });

    expect(result).toEqual({ ok: false, reason: 'invite_expired' });
    expect(await testPrisma.inviteTree.count()).toBe(1);
  });

  it('writes no edge when an invite registration is refused', async () => {
    const inviter = await registerUser({
      username: 'inviter',
      email: 'inviter@example.com',
      password: 'password1',
      registrationMode: 'open',
      maxUsers: 7000
    });
    if (!inviter.ok) throw new Error('fixture registration failed');
    await testPrisma.invite.create({
      data: {
        inviterId: inviter.user.id,
        inviteKey: 'k1',
        email: 'joiner@example.com',
        expires: new Date(Date.now() - 1000)
      }
    });

    await registerUser({
      username: 'joiner',
      email: 'joiner@example.com',
      password: 'password1',
      registrationMode: 'invite',
      maxUsers: 7000,
      inviteKey: 'k1'
    });

    expect(await testPrisma.inviteTree.count()).toBe(1);
  });

  it('gives staff-created and System accounts a row with no inviter', async () => {
    const systemId = await seedSystemUser(testPrisma);
    // createUser audits against an actor, so use the System user as one.
    const staff = await createUser(
      { username: 'made', email: 'made@example.com', password: 'password1' },
      systemId
    );

    expect(await rowOf(staff.id)).toMatchObject({ inviterId: null });
    expect(await rowOf(systemId)).toMatchObject({ inviterId: null });
  });
});

describe('GET /users/invite-tree data', () => {
  it('lists invited members by default, and everyone with all', async () => {
    const root = await registerUser({
      username: 'root',
      email: 'root@example.com',
      password: 'password1',
      registrationMode: 'open',
      maxUsers: 7000
    });
    if (!root.ok) throw new Error('fixture registration failed');
    await testPrisma.invite.create({
      data: {
        inviterId: root.user.id,
        inviteKey: 'k1',
        email: 'kid@example.com',
        expires: new Date(Date.now() + DAY)
      }
    });
    await registerUser({
      username: 'kid',
      email: 'kid@example.com',
      password: 'password1',
      registrationMode: 'invite',
      maxUsers: 7000,
      inviteKey: 'k1'
    });

    const pg = { skip: 0, limit: 50 };
    const invited = await getInviteTree(pg);
    const everyone = await getInviteTree(pg, true);

    expect(invited.total).toBe(1);
    expect(invited.rows[0].user.username).toBe('kid');
    expect(everyone.total).toBe(2);
  });
});

describe('the migration backfill', () => {
  let seq = 0;
  const mkUser = async (email: string, registeredDaysAgo: number) => {
    seq += 1;
    const rank = await testPrisma.userRank.findFirstOrThrow();
    const settings = await testPrisma.userSettings.create({ data: {} });
    const profile = await testPrisma.profile.create({ data: {} });
    // No inviteTree here on purpose: these stand in for pre-#633 accounts.
    return testPrisma.user.create({
      data: {
        username: `legacy-${seq}`,
        email,
        password: 'x',
        userRankId: rank.id,
        userSettingsId: settings.id,
        profileId: profile.id,
        dateRegistered: at(registeredDaysAgo)
      }
    });
  };
  const changeEmail = (userId: number, oldEmail: string, daysAgo: number) =>
    testPrisma.userEmailHistory.create({
      data: {
        userId,
        oldEmail,
        newEmail: `moved-${userId}@example.com`,
        changedAt: at(daysAgo)
      }
    });
  const accepted = (inviterId: number, email: string, sentDaysAgo: number) =>
    testPrisma.invite.create({
      data: {
        inviterId,
        email,
        inviteKey: `key-${email}`,
        status: 'accepted',
        expires: at(sentDaysAgo - 3),
        createdAt: at(sentDaysAgo)
      }
    });
  const backfill = () => testPrisma.$executeRawUnsafe(BACKFILL_SQL);

  it('recovers the inviter from the current email, dated at registration', async () => {
    const inviter = await mkUser('inviter@example.com', 100);
    const member = await mkUser('member@example.com', 50);
    await accepted(inviter.id, 'member@example.com', 51);

    await backfill();

    const row = await rowOf(member.id);
    expect(row?.inviterId).toBe(inviter.id);
    expect(row?.createdAt.getTime()).toBe(member.dateRegistered.getTime());
    expect((await rowOf(inviter.id))?.inviterId).toBeNull();
  });

  it('recovers the inviter through email history when the member changed email', async () => {
    const inviter = await mkUser('inviter@example.com', 100);
    const member = await mkUser('now-elsewhere@example.com', 50);
    await changeEmail(member.id, 'original@example.com', 20);
    await accepted(inviter.id, 'original@example.com', 51);

    await backfill();

    expect((await rowOf(member.id))?.inviterId).toBe(inviter.id);
  });

  it('does not credit a member who held the address before the invite was sent', async () => {
    // P registered z openly, then moved; later I invited z and Q took it.
    const inviter = await mkUser('inviter@example.com', 200);
    const earlier = await mkUser('p-now@example.com', 100);
    await changeEmail(earlier.id, 'z@example.com', 90);
    await accepted(inviter.id, 'z@example.com', 60);
    const later = await mkUser('z@example.com', 59);

    await backfill();

    expect((await rowOf(later.id))?.inviterId).toBe(inviter.id);
    expect((await rowOf(earlier.id))?.inviterId).toBeNull();
  });

  it('never records a member as having invited themselves', async () => {
    // U registered x, moved, then invited x. The invite's createdAt is written
    // BEFORE U registered, as unreliable data can be (a devTools row), so only
    // the self exclusion keeps U from matching their own invite.
    const u = await mkUser('u-now@example.com', 100);
    await changeEmail(u.id, 'x@example.com', 90);
    await accepted(u.id, 'x@example.com', 120);
    const c = await mkUser('x@example.com', 59);

    await backfill();

    expect((await rowOf(u.id))?.inviterId).toBeNull();
    expect((await rowOf(c.id))?.inviterId).toBe(u.id);
  });

  it('leaves an existing row alone, and gives every other account exactly one', async () => {
    const a = await mkUser('a@example.com', 100);
    const b = await mkUser('b@example.com', 90);
    const c = await mkUser('c@example.com', 80);
    await testPrisma.inviteTree.create({
      data: { userId: c.id, inviterId: a.id }
    });
    // An accepted invite nobody matches must not break anything.
    await accepted(a.id, 'ghost@example.com', 70);

    await backfill();
    await backfill(); // idempotent

    expect((await rowOf(c.id))?.inviterId).toBe(a.id);
    expect((await rowOf(b.id))?.inviterId).toBeNull();
    expect(await testPrisma.inviteTree.count()).toBe(
      await testPrisma.user.count()
    );
  });
});
