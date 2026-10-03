/**
 * Staff read every community's administrative record, and not its contents
 * (#902, ADR-0055), against a real database: a closed community, and staff who
 * hold no role in it.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CommunityType, RegistrationStatus } from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { auth as authConfig } from '../modules/config';
import app from '../app';

let leaderId: number;
let curatorId: number;
let staffId: number;
let adminId: number;
let outsiderId: number;
let closedId: number;

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

const get = (path: string, viewer: number) =>
  request(app).get(`/api${path}`).set(session(viewer));

beforeEach(async () => {
  ipCount += 1;
  clientIp = `10.2.${Math.floor(ipCount / 250)}.${(ipCount % 250) + 1}`;
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
  const adminRank = await testPrisma.userRank.create({
    data: { level: 900, name: 'Admin', permissions: { admin: true } }
  });
  leaderId = await makeUser('leader', rank.id);
  curatorId = await makeUser('curator', rank.id);
  outsiderId = await makeUser('outsider', rank.id);
  staffId = await makeUser('staff', staffRank.id);
  adminId = await makeUser('admin', adminRank.id);
  const closed = await testPrisma.community.create({
    data: {
      name: 'Closed',
      image: '',
      type: CommunityType.Music,
      registrationStatus: RegistrationStatus.closed,
      leaderId,
      curators: { connect: [{ id: leaderId }, { id: curatorId }] },
      leadershipEvents: { create: { kind: 'founded', toUserId: leaderId } }
    }
  });
  closedId = closed.id;
  await testPrisma.community.create({
    data: {
      name: 'Open',
      image: '',
      type: CommunityType.Music,
      registrationStatus: RegistrationStatus.open
    }
  });
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('the administrative record (ADR-0055 §2)', () => {
  it('is readable by staff and admins who hold no role', async () => {
    for (const viewer of [staffId, adminId]) {
      const res = await get(`/communities/${closedId}`, viewer);
      expect(res.status).toBe(200);
      expect(res.body.leaderId).toBe(leaderId);
      expect(
        res.body.members.map((m: { username: string }) => m.username).sort()
      ).toEqual(['curator', 'leader']);
    }
  });

  it('shows staff the pending offer and the leadership log', async () => {
    const offer = await request(app)
      .post(`/api/communities/${closedId}/leader-offer`)
      .set(session(leaderId))
      .send({ userId: curatorId });
    expect(offer.status).toBe(204);

    const detail = await get(`/communities/${closedId}`, staffId);
    const log = await get(`/communities/${closedId}/leadership-log`, staffId);

    expect(detail.body.leaderOffer?.to.id).toBe(curatorId);
    expect(log.status).toBe(200);
    expect(log.body.data.map((e: { kind: string }) => e.kind)).toEqual([
      'founded'
    ]);
  });

  it('stays closed to a member of nothing without the permission', async () => {
    expect((await get(`/communities/${closedId}`, outsiderId)).status).toBe(
      403
    );
    expect(
      (await get(`/communities/${closedId}/leadership-log`, outsiderId)).status
    ).toBe(403);
  });
});

describe('the contents stay member-only (ADR-0055 §2)', () => {
  it('refuses staff the release list and health', async () => {
    expect(
      (await get(`/communities/${closedId}/releases`, staffId)).status
    ).toBe(403);
    expect((await get(`/communities/${closedId}/health`, staffId)).status).toBe(
      403
    );
  });

  // Reading the record grants no write: the handoff stays the leader's and
  // the successor's (ADR-0053), and staff reassign through PUT instead.
  it('does not let staff act in the handoff', async () => {
    const offer = await request(app)
      .post(`/api/communities/${closedId}/leader-offer`)
      .set(session(staffId))
      .send({ userId: curatorId });
    const res = await request(app)
      .post(`/api/communities/${closedId}/leader-offer/accept`)
      .set(session(staffId));

    expect(offer.status).toBe(403);
    expect(res.status).toBe(403);
    expect(
      (
        await testPrisma.community.findUniqueOrThrow({
          where: { id: closedId }
        })
      ).leaderId
    ).toBe(leaderId);
  });
});

describe('GET /communities/manage', () => {
  it('lists every community for staff, closed ones included', async () => {
    const res = await get('/communities/manage', staffId);

    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { name: string }) => c.name)).toEqual([
      'Closed',
      'Open'
    ]);
    expect(res.body.meta).toEqual(expect.objectContaining({ total: 2 }));
  });

  it('refuses a member without the permission', async () => {
    expect((await get('/communities/manage', outsiderId)).status).toBe(403);
  });

  it('leaves the member browse as it was, for staff too', async () => {
    const res = await get('/communities', staffId);

    expect(res.body.data.map((c: { name: string }) => c.name)).toEqual([
      'Open'
    ]);
  });
});
