/**
 * The leadership handoff against a real database (#896, ADR-0053 §3–8). The
 * lapse rules are relation filters inside conditional writes, and the offer
 * columns are hidden by the client's global `omit`; a mocked Prisma can show
 * neither, so both are exercised here through the app.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CommunityType, RegistrationStatus } from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { auth as authConfig } from '../modules/config';
import { prisma } from '../lib/prisma';
import app from '../app';

let leaderId: number;
let successorId: number;
let curatorId: number;
let staffId: number;
let communityId: number;

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

// The app limits mutations to 30 a minute per client IP, and this file makes
// more than that; each test gets an address of its own.
let clientIp = '';
let ipCount = 0;

const session = (userId: number) => ({
  Cookie: `token=${jwt.sign({ user: { id: userId } }, authConfig.jwtSecret, {
    expiresIn: 60
  })}`,
  'X-Forwarded-For': clientIp
});

const offerTo = (userId: number) =>
  request(app)
    .post(`/api/communities/${communityId}/leader-offer`)
    .set(session(leaderId))
    .send({ userId });

const answer = (userId: number, verb: 'accept' | 'decline') =>
  request(app)
    .post(`/api/communities/${communityId}/leader-offer/${verb}`)
    .set(session(userId));

const stored = () =>
  testPrisma.community.findUniqueOrThrow({
    where: { id: communityId },
    select: {
      leaderId: true,
      leaderOfferToId: true,
      leaderOfferedAt: true,
      curators: { select: { id: true }, orderBy: { id: 'asc' } }
    }
  });

const notified = (userId: number) =>
  testPrisma.notification.findMany({
    where: { userId },
    select: { type: true, actorId: true, page: true, pageId: true }
  });

const audited = async () =>
  (
    await testPrisma.auditLog.findMany({
      where: { targetType: 'community', targetId: communityId },
      orderBy: { id: 'asc' },
      select: { action: true }
    })
  ).map((row) => row.action);

beforeEach(async () => {
  ipCount += 1;
  clientIp = `10.0.${Math.floor(ipCount / 250)}.${(ipCount % 250) + 1}`;
  await truncateAll();
  await seedDefaults();
  // The install barrier answers 503 to every route until this is stamped.
  await testPrisma.siteSettings.create({
    data: { id: 1, dismissedLaunchChecklist: [], installedAt: new Date() }
  });
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const staffRank = await testPrisma.userRank.create({
    data: {
      level: 500,
      name: 'Staff',
      permissions: { communities_manage: true }
    }
  });
  leaderId = await makeUser('leader', rank.id);
  successorId = await makeUser('successor', rank.id);
  curatorId = await makeUser('curator', rank.id);
  staffId = await makeUser('staff', staffRank.id);
  const community = await testPrisma.community.create({
    data: {
      name: 'Jazz',
      image: '',
      type: CommunityType.Music,
      registrationStatus: RegistrationStatus.closed,
      leaderId,
      curators: {
        connect: [{ id: leaderId }, { id: successorId }, { id: curatorId }]
      }
    }
  });
  communityId = community.id;
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('offering leadership', () => {
  it('stores the offer, notifies the successor and audits it', async () => {
    const res = await offerTo(successorId);

    expect(res.status).toBe(204);
    const row = await stored();
    expect(row.leaderOfferToId).toBe(successorId);
    expect(row.leaderOfferedAt).toBeInstanceOf(Date);
    expect(await notified(successorId)).toEqual([
      {
        type: 'community_leader_offered',
        actorId: leaderId,
        page: 'communities',
        pageId: communityId
      }
    ]);
    expect(await audited()).toEqual(['community.leader.offer']);
  });

  it('replaces a pending offer with a new one', async () => {
    await offerTo(successorId);
    await offerTo(curatorId);

    expect((await stored()).leaderOfferToId).toBe(curatorId);
  });

  it('refuses a curator who is not the leader with 403', async () => {
    const res = await request(app)
      .post(`/api/communities/${communityId}/leader-offer`)
      .set(session(curatorId))
      .send({ userId: successorId });

    expect(res.status).toBe(403);
    expect((await stored()).leaderOfferToId).toBeNull();
  });

  it('refuses 409 for a target who is not a curator', async () => {
    const res = await offerTo(staffId);

    expect(res.status).toBe(409);
    expect((await stored()).leaderOfferToId).toBeNull();
  });

  it('refuses 409 for a disabled curator', async () => {
    await testPrisma.user.update({
      where: { id: successorId },
      data: { disabled: true }
    });

    expect((await offerTo(successorId)).status).toBe(409);
  });

  it('refuses 409 for an offer to the leader themselves', async () => {
    expect((await offerTo(leaderId)).status).toBe(409);
  });

  it('answers a hidden community as GET /:id does (#771)', async () => {
    const rank = await testPrisma.userRank.findFirstOrThrow({
      where: { name: 'User' }
    });
    const outsiderId = await makeUser('outsider', rank.id);
    const res = await request(app)
      .post(`/api/communities/${communityId}/leader-offer`)
      .set(session(outsiderId))
      .send({ userId: successorId });
    const read = await request(app)
      .get(`/api/communities/${communityId}`)
      .set(session(outsiderId));

    // An outsider holds no role here, so a closed community is unreadable.
    // (Staff read its record since ADR-0055, but still cannot offer.)
    expect(res.status).toBe(read.status);
    expect(res.status).toBe(403);
  });
});

describe('accepting', () => {
  it('moves the leader, keeps the outgoing one a curator, and ends the offer', async () => {
    await offerTo(successorId);

    const res = await answer(successorId, 'accept');

    expect(res.status).toBe(204);
    const row = await stored();
    expect(row.leaderId).toBe(successorId);
    expect(row.leaderOfferToId).toBeNull();
    expect(row.leaderOfferedAt).toBeNull();
    expect(row.curators.map((c) => c.id)).toEqual(
      [leaderId, successorId, curatorId].sort((a, b) => a - b)
    );
    expect(await notified(leaderId)).toEqual([
      {
        type: 'community_leader_accepted',
        actorId: successorId,
        page: 'communities',
        pageId: communityId
      }
    ]);
    expect(await audited()).toEqual([
      'community.leader.offer',
      'community.leader.accept',
      'community.leader.set'
    ]);
  });

  it('answers 404 to anyone but the successor, the leader included', async () => {
    await offerTo(successorId);

    expect((await answer(curatorId, 'accept')).status).toBe(404);
    expect((await answer(leaderId, 'accept')).status).toBe(404);
    expect((await stored()).leaderId).toBe(leaderId);
  });

  it('answers 404 with no offer', async () => {
    expect((await answer(successorId, 'accept')).status).toBe(404);
  });

  describe('a lapsed offer is treated as absent (ADR-0053 §5)', () => {
    beforeEach(async () => {
      await offerTo(successorId);
    });

    it('after 7 days', async () => {
      await testPrisma.community.update({
        where: { id: communityId },
        data: {
          leaderOfferedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1000)
        }
      });

      expect((await answer(successorId, 'accept')).status).toBe(404);
      expect((await stored()).leaderId).toBe(leaderId);
    });

    // In an open community, so the access gate passes and the lapse decides.
    it('when the successor is no longer a curator', async () => {
      await testPrisma.community.update({
        where: { id: communityId },
        data: {
          registrationStatus: RegistrationStatus.open,
          curators: { disconnect: { id: successorId } }
        }
      });

      expect((await answer(successorId, 'accept')).status).toBe(404);
      expect((await stored()).leaderId).toBe(leaderId);
    });

    it('when the successor is disabled', async () => {
      await testPrisma.user.update({
        where: { id: successorId },
        data: { disabled: true }
      });

      // A disabled user holds no session, so read the live offer as the leader.
      const read = await request(app)
        .get(`/api/communities/${communityId}`)
        .set(session(leaderId));
      expect(read.body.leaderOffer).toBeNull();
    });

    it('when the leader who made it is disabled', async () => {
      await testPrisma.user.update({
        where: { id: leaderId },
        data: { disabled: true }
      });

      expect((await answer(successorId, 'accept')).status).toBe(404);
      expect((await stored()).leaderId).toBe(leaderId);
    });
  });

  // The pre-read saw the old leader; by the claim, someone else leads. The
  // conditional write must not move leadership over that change.
  it('does not overwrite a leader change made after its read', async () => {
    await offerTo(successorId);
    await testPrisma.community.update({
      where: { id: communityId },
      data: { leaderId: curatorId }
    });
    // Stub only the offer pre-read (it selects `leaderId`); the access gate's
    // own findFirst still reads the database.
    const findFirst = prisma.community.findFirst.bind(prisma.community);
    jest
      .spyOn(prisma.community, 'findFirst')
      .mockImplementation(((args: { select?: { leaderId?: boolean } }) =>
        args.select?.leaderId
          ? Promise.resolve({ leaderId })
          : findFirst(args as never)) as never);

    const res = await answer(successorId, 'accept');

    expect(res.status).toBe(404);
    expect((await stored()).leaderId).toBe(curatorId);
    expect(await notified(leaderId)).toEqual([]);
  });
});

describe('declining', () => {
  it('ends the offer, keeps the leader, and notifies them', async () => {
    await offerTo(successorId);

    const res = await answer(successorId, 'decline');

    expect(res.status).toBe(204);
    const row = await stored();
    expect(row.leaderId).toBe(leaderId);
    expect(row.leaderOfferToId).toBeNull();
    expect(await notified(leaderId)).toEqual([
      {
        type: 'community_leader_declined',
        actorId: successorId,
        page: 'communities',
        pageId: communityId
      }
    ]);
    expect(await audited()).toEqual([
      'community.leader.offer',
      'community.leader.decline'
    ]);
  });
});

describe('withdrawing', () => {
  const withdraw = (userId: number) =>
    request(app)
      .delete(`/api/communities/${communityId}/leader-offer`)
      .set(session(userId));

  it('ends the offer and audits it, notifying no one', async () => {
    await offerTo(successorId);

    expect((await withdraw(leaderId)).status).toBe(204);
    expect((await stored()).leaderOfferToId).toBeNull();
    expect(await audited()).toEqual([
      'community.leader.offer',
      'community.leader.withdraw'
    ]);
    expect(await notified(successorId)).toHaveLength(1);
    expect((await answer(successorId, 'accept')).status).toBe(404);
  });

  it('answers 204 with nothing to withdraw, auditing nothing', async () => {
    expect((await withdraw(leaderId)).status).toBe(204);
    expect(await audited()).toEqual([]);
  });

  it('refuses anyone but the leader with 403', async () => {
    await offerTo(successorId);

    expect((await withdraw(successorId)).status).toBe(403);
    expect((await stored()).leaderOfferToId).toBe(successorId);
  });
});

describe('GET /communities/:id leaderOffer (ADR-0053 §8)', () => {
  const read = (userId: number) =>
    request(app).get(`/api/communities/${communityId}`).set(session(userId));

  beforeEach(async () => {
    await offerTo(successorId);
  });

  it('shows the live offer to the leader and the successor', async () => {
    for (const viewer of [leaderId, successorId]) {
      const res = await read(viewer);
      expect(res.status).toBe(200);
      expect(res.body.leaderOffer).toEqual({
        to: { id: successorId, username: 'successor' },
        offeredAt: expect.any(String)
      });
    }
  });

  it('shows it to staff', async () => {
    await testPrisma.community.update({
      where: { id: communityId },
      data: { registrationStatus: RegistrationStatus.open }
    });

    const res = await read(staffId);

    expect(res.body.leaderOffer?.to.id).toBe(successorId);
  });

  it('hides it from another curator', async () => {
    const res = await read(curatorId);

    expect(res.status).toBe(200);
    expect(res.body.leaderOffer).toBeNull();
  });

  it('never carries the stored columns, on any community response', async () => {
    const one = await read(curatorId);
    const list = await request(app)
      .get('/api/communities')
      .set(session(curatorId));
    const put = await request(app)
      .put(`/api/communities/${communityId}`)
      .set(session(staffId))
      .send({ description: 'Edited' });

    for (const body of [one.body, list.body.data[0], put.body]) {
      expect(body).not.toHaveProperty('leaderOfferToId');
      expect(body).not.toHaveProperty('leaderOfferedAt');
    }
  });
});

describe('a staff PUT /communities/:id', () => {
  const put = (body: Record<string, unknown>) =>
    request(app)
      .put(`/api/communities/${communityId}`)
      .set(session(staffId))
      .send(body);

  beforeEach(async () => {
    await offerTo(successorId);
  });

  it('ends the offer when it reassigns the leader', async () => {
    expect((await put({ leaderId: curatorId })).status).toBe(200);

    const row = await stored();
    expect(row.leaderId).toBe(curatorId);
    expect(row.leaderOfferToId).toBeNull();
    expect(row.leaderOfferedAt).toBeNull();
  });

  it('keeps the offer when it sends the current leader unchanged', async () => {
    expect((await put({ leaderId, description: 'x' })).status).toBe(200);

    expect((await stored()).leaderOfferToId).toBe(successorId);
  });
});
