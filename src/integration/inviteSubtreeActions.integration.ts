/**
 * Staff actions on a member's invite subtree (#639), against a real database.
 *
 * The tree: root R invited A and B, and A invited C. O is an outsider. B is
 * already disabled, and C already cannot invite, so each action meets one
 * member already in its target state.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { auth as authConfig } from '../modules/config';
import app from '../app';

let ids: Record<'R' | 'A' | 'B' | 'C' | 'O', number>;
let rankId: number;

// The app limits mutations to 30 a minute per client IP; each test gets its own.
let clientIp = '';
let ipCount = 0;

const session = (userId: number) => ({
  Cookie: `token=${jwt.sign({ user: { id: userId } }, authConfig.jwtSecret, {
    expiresIn: 60
  })}`,
  'X-Forwarded-For': clientIp
});

const makeUser = async (username: string, userRankId: number) => {
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const user = await testPrisma.user.create({
    data: {
      username,
      email: `${username}@test.local`,
      password: 'x',
      avatar: '',
      userRankId,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
  return user.id;
};

const staffWith = async (permissions: Record<string, boolean>) => {
  const rank = await testPrisma.userRank.create({
    data: { level: 500 + ipCount, name: `staff-${ipCount}`, permissions }
  });
  return makeUser(`staff${Object.keys(permissions).join('-')}`, rank.id);
};

const edge = (userId: number, inviterId: number | null) =>
  testPrisma.inviteTree.create({ data: { userId, inviterId } });

const preview = (staffId: number, rootId = ids.R) =>
  request(app)
    .get(`/api/users/${rootId}/invite-subtree/preview`)
    .set(session(staffId));

const act = (staffId: number, body: Record<string, unknown>) =>
  request(app)
    .post(`/api/users/${ids.R}/invite-subtree/action`)
    .set(session(staffId))
    .send({ reason: 'invite ring', expectedCount: 3, ...body });

const state = async (id: number) =>
  testPrisma.user.findUniqueOrThrow({
    where: { id },
    select: { disabled: true, canInvite: true }
  });

const auditsFor = (action: string) =>
  testPrisma.auditLog.findMany({ where: { action }, orderBy: { id: 'asc' } });

beforeEach(async () => {
  ipCount += 1;
  clientIp = `10.6.${Math.floor(ipCount / 250)}.${(ipCount % 250) + 1}`;
  await truncateAll();
  await seedDefaults();
  // The install barrier answers 503 to every route until this is stamped.
  await testPrisma.siteSettings.create({
    data: { id: 1, dismissedLaunchChecklist: [], installedAt: new Date() }
  });
  rankId = (await testPrisma.userRank.findFirstOrThrow()).id;
  const R = await makeUser('root', rankId);
  const A = await makeUser('alpha', rankId);
  const B = await makeUser('bravo', rankId);
  const C = await makeUser('charlie', rankId);
  const O = await makeUser('outsider', rankId);
  ids = { R, A, B, C, O };
  await edge(R, null);
  await edge(A, R);
  await edge(B, R);
  await edge(C, A);
  await edge(O, null);
  await testPrisma.user.update({ where: { id: B }, data: { disabled: true } });
  await testPrisma.user.update({
    where: { id: C },
    data: { canInvite: false }
  });
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('GET /users/:id/invite-subtree/preview', () => {
  it('lists every descendant, the root excluded, by depth', async () => {
    const res = await preview(await staffWith({ invites_manage: true }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      rootUserId: ids.R,
      count: 3,
      disabled: 1,
      withoutInvites: 1
    });
    expect(res.body.members.map((m: { id: number }) => m.id)).toEqual([
      ids.A,
      ids.B,
      ids.C
    ]);
    expect(res.body.members[2]).toMatchObject({ depth: 2, canInvite: false });
  });

  it('needs invites_manage', async () => {
    const res = await preview(await staffWith({ users_disable: true }));
    expect(res.status).toBe(403);
  });

  it('answers 404 for a missing member', async () => {
    const res = await preview(
      await staffWith({ invites_manage: true }),
      999_999
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /users/:id/invite-subtree/action', () => {
  it('disables every descendant not already disabled, and notes all of them', async () => {
    const staffId = await staffWith({
      invites_manage: true,
      users_disable: true
    });

    const res = await act(staffId, { action: 'disable' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      action: 'disable',
      count: 3,
      changed: 2,
      unchanged: 1
    });
    expect((await state(ids.A)).disabled).toBe(true);
    expect((await state(ids.C)).disabled).toBe(true);
    expect((await state(ids.R)).disabled).toBe(false);
    expect((await state(ids.O)).disabled).toBe(false);

    const notes = await testPrisma.userModerationNote.findMany({
      orderBy: { userId: 'asc' }
    });
    expect(notes.map((n) => n.userId)).toEqual([ids.A, ids.B, ids.C]);
    expect(notes[0]).toMatchObject({ authorId: staffId });
    expect(notes[0].body).toMatch(/disable.*root.*\n.*invite ring/s);

    // B was already disabled: a note, but no write and no audit row.
    const disabled = await auditsFor('user.disabled');
    expect(disabled.map((a) => a.targetId)).toEqual([ids.A, ids.C]);
    expect(disabled[0].metadata).toEqual({ subtreeRootId: ids.R });

    const [run] = await auditsFor('user.invite_subtree_action');
    expect(run).toMatchObject({ targetId: ids.R, actorId: staffId });
    expect(run.metadata).toEqual({
      action: 'disable',
      reason: 'invite ring',
      count: 3,
      userIds: [ids.A, ids.C]
    });
  });

  it('revokes invite privileges from every descendant who still has them', async () => {
    const res = await act(
      await staffWith({ invites_manage: true, invites_edit: true }),
      { action: 'revoke_invites' }
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: 2, unchanged: 1 });
    expect((await state(ids.A)).canInvite).toBe(false);
    expect((await state(ids.B)).canInvite).toBe(false);
    expect((await state(ids.R)).canInvite).toBe(true);

    const changes = await auditsFor('user.can_invite_changed');
    expect(changes.map((a) => a.targetId)).toEqual([ids.A, ids.B]);
    expect(changes[0].metadata).toMatchObject({
      canInvite: false,
      reason: 'invite ring',
      messaged: false,
      subtreeRootId: ids.R
    });
  });

  it('notes every descendant and changes nothing else', async () => {
    const res = await act(
      await staffWith({ invites_manage: true, users_edit: true }),
      { action: 'note' }
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: 3, unchanged: 0 });
    expect(await testPrisma.userModerationNote.count()).toBe(3);
    expect(await state(ids.A)).toEqual({ disabled: false, canInvite: true });
    expect(await auditsFor('user.disabled')).toEqual([]);
  });

  it('refuses a stale count and writes nothing', async () => {
    const res = await act(
      await staffWith({ invites_manage: true, users_disable: true }),
      { action: 'disable', expectedCount: 2 }
    );

    expect(res.status).toBe(409);
    expect(await state(ids.A)).toEqual({ disabled: false, canInvite: true });
    expect(await testPrisma.userModerationNote.count()).toBe(0);
    expect(await auditsFor('user.invite_subtree_action')).toEqual([]);
  });

  it("needs the action's own permission, not only invites_manage", async () => {
    const res = await act(await staffWith({ invites_manage: true }), {
      action: 'disable'
    });

    expect(res.status).toBe(403);
    expect(res.body.msg).toMatch(/users_disable/);
    expect((await state(ids.A)).disabled).toBe(false);
    expect(await testPrisma.userModerationNote.count()).toBe(0);
  });
});
