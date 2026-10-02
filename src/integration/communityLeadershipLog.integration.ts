/**
 * A community's leadership log against a real database (#897, ADR-0054): the
 * writers at each change, the read and its actor rule, and the migration's
 * backfill. The backfill is the migration's own SQL, re-run here against audit
 * rows the real routes wrote, so the test exercises what ships.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CommunityType, RegistrationStatus } from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { auth as authConfig } from '../modules/config';
import { seedDefaultCommunity } from '../modules/bootstrap';
import app from '../app';

let leaderId: number;
let successorId: number;
let curatorId: number;
let staffId: number;
let outsiderId: number;

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

const createCommunity = async (name: string, leader: number) => {
  const res = await request(app)
    .post('/api/communities')
    .set(session(staffId))
    .send({
      name,
      type: CommunityType.Music,
      registrationStatus: RegistrationStatus.open,
      leaderId: leader,
      curatorIds: [leaderId, successorId, curatorId]
    });
  expect(res.status).toBe(201);
  return res.body.id as number;
};

const putLeader = async (communityId: number, leader: number | null) => {
  const res = await request(app)
    .put(`/api/communities/${communityId}`)
    .set(session(staffId))
    .send({ leaderId: leader });
  expect(res.status).toBe(200);
};

const handOff = async (communityId: number, from: number, to: number) => {
  const offer = await request(app)
    .post(`/api/communities/${communityId}/leader-offer`)
    .set(session(from))
    .send({ userId: to });
  expect(offer.status).toBe(204);
  const accept = await request(app)
    .post(`/api/communities/${communityId}/leader-offer/accept`)
    .set(session(to));
  expect(accept.status).toBe(204);
};

/** Oldest first, as the comparisons read. */
const events = (communityId: number) =>
  testPrisma.communityLeadershipEvent.findMany({
    where: { communityId },
    orderBy: [{ at: 'asc' }, { id: 'asc' }],
    select: { kind: true, fromUserId: true, toUserId: true, actorId: true }
  });

const readLog = (communityId: number, viewer: number, query = '') =>
  request(app)
    .get(`/api/communities/${communityId}/leadership-log${query}`)
    .set(session(viewer));

beforeEach(async () => {
  ipCount += 1;
  clientIp = `10.1.${Math.floor(ipCount / 250)}.${(ipCount % 250) + 1}`;
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
  outsiderId = await makeUser('outsider', rank.id);
  staffId = await makeUser('staff', staffRank.id);
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('writing the log', () => {
  it('logs each change, and nothing for an unchanged leader', async () => {
    const id = await createCommunity('Jazz', leaderId);
    await putLeader(id, leaderId); // unchanged: no row
    await putLeader(id, curatorId);
    await putLeader(id, leaderId);
    await handOff(id, leaderId, successorId);
    await putLeader(id, null);

    expect(await events(id)).toEqual([
      {
        kind: 'founded',
        fromUserId: null,
        toUserId: leaderId,
        actorId: staffId
      },
      {
        kind: 'assigned',
        fromUserId: leaderId,
        toUserId: curatorId,
        actorId: staffId
      },
      {
        kind: 'assigned',
        fromUserId: curatorId,
        toUserId: leaderId,
        actorId: staffId
      },
      {
        kind: 'handed_off',
        fromUserId: leaderId,
        toUserId: successorId,
        actorId: successorId
      },
      {
        kind: 'cleared',
        fromUserId: successorId,
        toUserId: null,
        actorId: staffId
      }
    ]);
  });

  it('logs no change for a community created without a leader', async () => {
    const res = await request(app)
      .post('/api/communities')
      .set(session(staffId))
      .send({
        name: 'Open',
        type: CommunityType.Music,
        registrationStatus: RegistrationStatus.open
      });

    expect(await events(res.body.id)).toEqual([]);
  });

  it("logs the boot seed's site community as founded, with no actor", async () => {
    await seedDefaultCommunity(testPrisma, leaderId);
    const site = await testPrisma.community.findFirstOrThrow();

    expect(await events(site.id)).toEqual([
      { kind: 'founded', fromUserId: null, toUserId: leaderId, actorId: null }
    ]);
  });
});

describe('GET /communities/:id/leadership-log', () => {
  let id: number;

  beforeEach(async () => {
    id = await createCommunity('Jazz', leaderId);
    await handOff(id, leaderId, successorId);
  });

  it('serves the log newest first, with no actor for a member', async () => {
    const res = await readLog(id, curatorId);

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual(
      expect.objectContaining({ total: 2, page: 1 })
    );
    expect(res.body.data).toEqual([
      {
        id: expect.any(Number),
        kind: 'handed_off',
        from: { id: leaderId, username: 'leader' },
        to: { id: successorId, username: 'successor' },
        actor: null,
        at: expect.any(String)
      },
      {
        id: expect.any(Number),
        kind: 'founded',
        from: null,
        to: { id: leaderId, username: 'leader' },
        actor: null,
        at: expect.any(String)
      }
    ]);
  });

  it('names the actor for staff', async () => {
    const res = await readLog(id, staffId);

    expect(res.body.data.map((e: { actor: unknown }) => e.actor)).toEqual([
      { id: successorId, username: 'successor' },
      { id: staffId, username: 'staff' }
    ]);
  });

  it('pages', async () => {
    const res = await readLog(id, curatorId, '?limit=1&page=2');

    expect(res.body.data.map((e: { kind: string }) => e.kind)).toEqual([
      'founded'
    ]);
    expect(res.body.meta).toEqual(
      expect.objectContaining({ total: 2, totalPages: 2 })
    );
  });

  it('answers as GET /:id does for a hidden or missing community (#771)', async () => {
    await testPrisma.community.update({
      where: { id },
      data: { registrationStatus: RegistrationStatus.closed }
    });

    const hidden = await readLog(id, outsiderId);
    const detail = await request(app)
      .get(`/api/communities/${id}`)
      .set(session(outsiderId));
    expect(hidden.status).toBe(detail.status);
    expect(hidden.status).toBe(403);
    expect((await readLog(id + 1000, curatorId)).status).toBe(404);
  });
});

describe('the migration backfill (ADR-0054 §6)', () => {
  const backfill = async () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261003130000_community_leadership_log/migration.sql'
      ),
      'utf8'
    );
    const block = sql.slice(
      sql.indexOf('-- BEGIN BACKFILL'),
      sql.indexOf('-- END BACKFILL')
    );
    const statements = block
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter((s) => s.split('\n').some((l) => l && !l.startsWith('--')));
    expect(statements).toHaveLength(2);
    for (const statement of statements)
      await testPrisma.$executeRawUnsafe(statement);
  };

  it('rebuilds from the audit log what the writers logged', async () => {
    const id = await createCommunity('Jazz', leaderId);
    await putLeader(id, leaderId); // a no-op audit row (#901)
    await putLeader(id, curatorId);
    await handOff(id, curatorId, successorId);
    await putLeader(id, null);
    const written = await events(id);

    await testPrisma.communityLeadershipEvent.deleteMany();
    await backfill();

    expect(written).toHaveLength(4);
    expect(await events(id)).toEqual(written);
  });

  it('founds a leader no audit row explains', async () => {
    // Created outside the routes, as the boot seed and fixtures were.
    const community = await testPrisma.community.create({
      data: {
        name: 'Seeded',
        image: '',
        type: CommunityType.Music,
        registrationStatus: RegistrationStatus.open,
        leaderId,
        curators: { connect: [{ id: leaderId }, { id: curatorId }] }
      }
    });
    await testPrisma.communityLeadershipEvent.deleteMany();
    await backfill();

    expect(await events(community.id)).toEqual([
      { kind: 'founded', fromUserId: null, toUserId: leaderId, actorId: null }
    ]);
  });

  it('founds the first leader when the first audited change replaces them', async () => {
    const community = await testPrisma.community.create({
      data: {
        name: 'Seeded',
        image: '',
        type: CommunityType.Music,
        registrationStatus: RegistrationStatus.open,
        leaderId,
        curators: { connect: [{ id: leaderId }, { id: curatorId }] }
      }
    });
    await putLeader(community.id, curatorId);
    await testPrisma.communityLeadershipEvent.deleteMany();
    await backfill();

    expect(await events(community.id)).toEqual([
      { kind: 'founded', fromUserId: null, toUserId: leaderId, actorId: null },
      {
        kind: 'assigned',
        fromUserId: leaderId,
        toUserId: curatorId,
        actorId: staffId
      }
    ]);
  });

  it('logs nothing for a community that never had a leader', async () => {
    const community = await testPrisma.community.create({
      data: {
        name: 'Leaderless',
        image: '',
        type: CommunityType.Music,
        registrationStatus: RegistrationStatus.open
      }
    });
    await backfill();

    expect(await events(community.id)).toEqual([]);
  });
});
