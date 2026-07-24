import { CommunityType, RegistrationStatus } from '@prisma/client';
import {
  app,
  getCommunityHealthPulseMock,
  makeUserRank,
  prismaMock,
  request,
  resetApiTestState
} from './test/apiTestHarness';
import { communityRoleUnion } from './modules/communityAccess';

const makeCommunity = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Jazz',
  description: 'Jazz community',
  image: '/images/defaults/music.png',
  type: CommunityType.Music,
  registrationStatus: RegistrationStatus.open,
  allowDuplicateFormats: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  staff: [],
  consumers: [],
  _count: {
    contributors: 0,
    releases: 0,
    consumers: 0
  },
  ...overrides
});

beforeEach(() => resetApiTestState());

// The predicate itself is unit-tested in modules/communityAccess.spec.ts; here
// it is exercised through the routes that gate on it.

describe('GET /api/communities', () => {
  it('returns paginated communities the user can access', async () => {
    prismaMock.community.findMany.mockResolvedValue([makeCommunity()] as never);
    prismaMock.community.count.mockResolvedValue(1);

    const res = await request(app).get('/api/communities?page=2');

    expect(res.status).toBe(200);
    expect(prismaMock.community.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 25,
        take: 25,
        where: {
          OR: [
            { registrationStatus: RegistrationStatus.open },
            communityRoleUnion(7)
          ]
        }
      })
    );
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/communities/:id', () => {
  it('returns 404 when the community does not exist', async () => {
    prismaMock.community.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/communities/1');

    expect(res.status).toBe(404);
  });

  it('returns 403 when the user is not a member of a restricted community', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ registrationStatus: RegistrationStatus.invite }) as never
    );
    prismaMock.community.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/communities/1');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not a member of this community' });
  });

  it('lets a staff-only member read a closed community (#419)', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({
        registrationStatus: RegistrationStatus.closed,
        staff: [{ id: 7, username: 'staffer' }]
      }) as never
    );
    // The role union matches on the staff arm — no Consumer row involved.
    prismaMock.community.findFirst.mockResolvedValue({ id: 1 } as never);

    const res = await request(app).get('/api/communities/1');

    expect(res.status).toBe(200);
    expect(prismaMock.community.findFirst).toHaveBeenCalledWith({
      where: { id: 1, ...communityRoleUnion(7) },
      select: { id: true }
    });
  });

  it('returns the community when the user is allowed to view it', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);

    const res = await request(app).get('/api/communities/1');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Jazz');
  });
});

describe('GET /api/communities/:id/health', () => {
  it('returns 404 when the community does not exist', async () => {
    prismaMock.community.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/communities/1/health');

    expect(res.status).toBe(404);
  });

  it('returns the link-health pulse for a member', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    getCommunityHealthPulseMock.mockResolvedValue({
      pass: 6,
      warn: 2,
      fail: 2,
      unknown: 0,
      total: 10,
      checked: 8,
      coverage: 0.8,
      pulse: 0.75,
      status: 'Ailing'
    });

    const res = await request(app).get('/api/communities/1/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      pulse: 0.75,
      status: 'Ailing',
      checked: 8
    });
    expect(getCommunityHealthPulseMock).toHaveBeenCalledWith(1);
  });

  it('returns 403 when the user is not a member of a restricted community', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ registrationStatus: RegistrationStatus.invite }) as never
    );
    prismaMock.community.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/communities/1/health');

    expect(res.status).toBe(403);
    expect(getCommunityHealthPulseMock).not.toHaveBeenCalled();
  });

  it('serves the pulse to a staff-only member of a closed community (#419)', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ registrationStatus: RegistrationStatus.closed }) as never
    );
    prismaMock.community.findFirst.mockResolvedValue({ id: 1 } as never);
    getCommunityHealthPulseMock.mockResolvedValue({
      pass: 1,
      warn: 0,
      fail: 0,
      unknown: 0,
      total: 1,
      checked: 1,
      coverage: 1,
      pulse: 1,
      status: 'Healthy'
    });

    const res = await request(app).get('/api/communities/1/health');

    expect(res.status).toBe(200);
    expect(prismaMock.community.findFirst).toHaveBeenCalledWith({
      where: { id: 1, ...communityRoleUnion(7) },
      select: { id: true }
    });
  });
});

describe('GET /api/communities/:id/health/history', () => {
  it('returns 404 when the community does not exist', async () => {
    prismaMock.community.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/communities/1/health/history');

    expect(res.status).toBe(404);
  });

  it('returns the pulse history for a member (default period Daily)', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.communityHealthSnapshot.findMany.mockResolvedValue([
      {
        id: 1,
        communityId: 1,
        period: 'Daily',
        bucketAt: new Date('2026-06-16T00:00:00Z'),
        capturedAt: new Date('2026-06-16T00:00:00Z'),
        pass: 9,
        warn: 0,
        fail: 1,
        unknown: 0,
        total: 10,
        checked: 10,
        coverage: 1,
        pulse: 0.9,
        status: 'Healthy'
      }
    ] as never);

    const res = await request(app).get('/api/communities/1/health/history');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ status: 'Healthy', pulse: 0.9 });
    expect(prismaMock.communityHealthSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { communityId: 1, period: 'Daily' }
      })
    );
  });

  it('passes a valid period through to the query', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.communityHealthSnapshot.findMany.mockResolvedValue([] as never);

    const res = await request(app).get(
      '/api/communities/1/health/history?period=Monthly'
    );

    expect(res.status).toBe(200);
    expect(prismaMock.communityHealthSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { communityId: 1, period: 'Monthly' }
      })
    );
  });

  it('rejects an invalid period with 400', async () => {
    const res = await request(app).get(
      '/api/communities/1/health/history?period=Hourly'
    );

    expect(res.status).toBe(400);
  });

  it('returns 403 when the user is not a member of a restricted community', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ registrationStatus: RegistrationStatus.invite }) as never
    );
    prismaMock.community.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/communities/1/health/history');

    expect(res.status).toBe(403);
    expect(prismaMock.communityHealthSnapshot.findMany).not.toHaveBeenCalled();
  });

  it('serves history to a staff-only member of a closed community (#419)', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ registrationStatus: RegistrationStatus.closed }) as never
    );
    prismaMock.community.findFirst.mockResolvedValue({ id: 1 } as never);
    prismaMock.communityHealthSnapshot.findMany.mockResolvedValue([] as never);

    const res = await request(app).get('/api/communities/1/health/history');

    expect(res.status).toBe(200);
    expect(prismaMock.community.findFirst).toHaveBeenCalledWith({
      where: { id: 1, ...communityRoleUnion(7) },
      select: { id: true }
    });
  });
});

describe('POST /api/communities/:id/members', () => {
  it('returns 404 when the community does not exist', async () => {
    prismaMock.community.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/communities/1/members')
      .send({ userId: 8 });

    expect(res.status).toBe(404);
  });

  it('returns 403 when the caller lacks admin or community staff access', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);

    const res = await request(app)
      .post('/api/communities/1/members')
      .send({ userId: 8 });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Permission denied' });
  });

  it('returns 404 when the target user does not exist', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ staff: [{ id: 7 }] }) as never
    );
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/communities/1/members')
      .send({ userId: 8 });

    expect(res.status).toBe(404);
  });

  it('adds a member for community staff', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ staff: [{ id: 7 }] }) as never
    );
    prismaMock.user.findUnique.mockResolvedValue({ id: 8 } as never);
    prismaMock.consumer.upsert.mockResolvedValue({ id: 9, userId: 8 } as never);

    const res = await request(app)
      .post('/api/communities/1/members')
      .send({ userId: 8 });

    expect(res.status).toBe(201);
    expect(prismaMock.consumer.upsert).toHaveBeenCalledWith({
      where: { userId: 8 },
      create: { userId: 8, communities: { connect: { id: 1 } } },
      update: { communities: { connect: { id: 1 } } }
    });
  });
});

describe('DELETE /api/communities/:id/members/:userId', () => {
  it('returns 404 when the consumer record does not exist', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ staff: [{ id: 7 }] }) as never
    );
    prismaMock.consumer.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/communities/1/members/8');

    expect(res.status).toBe(404);
  });

  it('disconnects a member for admins', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.consumer.findUnique.mockResolvedValue({ userId: 8 } as never);
    prismaMock.consumer.update.mockResolvedValue({ userId: 8 } as never);

    const res = await request(app).delete('/api/communities/1/members/8');

    expect(res.status).toBe(204);
    expect(prismaMock.consumer.update).toHaveBeenCalledWith({
      where: { userId: 8 },
      data: { communities: { disconnect: { id: 1 } } }
    });
  });
});

describe('POST /api/communities/:id/staff', () => {
  it('returns 404 when the user does not exist', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ staff: [{ id: 7 }] }) as never
    );
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/communities/1/staff')
      .send({ userId: 8 });

    expect(res.status).toBe(404);
  });

  it('adds staff membership for admins', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.user.findUnique.mockResolvedValue({ id: 8 } as never);
    prismaMock.community.update.mockResolvedValue(makeCommunity() as never);

    const res = await request(app)
      .post('/api/communities/1/staff')
      .send({ userId: 8 });

    expect(res.status).toBe(204);
    expect(prismaMock.community.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { staff: { connect: { id: 8 } } }
    });
  });
});

describe('DELETE /api/communities/:id/staff/:userId', () => {
  it('removes staff membership for community staff', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ staff: [{ id: 7 }] }) as never
    );
    prismaMock.community.update.mockResolvedValue(makeCommunity() as never);

    const res = await request(app).delete('/api/communities/1/staff/8');

    expect(res.status).toBe(204);
    expect(prismaMock.community.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { staff: { disconnect: { id: 8 } } }
    });
  });
});

describe('POST /api/communities', () => {
  it('requires communities_manage permission', async () => {
    const res = await request(app).post('/api/communities').send({
      name: 'Jazz',
      type: 'Music',
      registrationStatus: 'open'
    });

    expect(res.status).toBe(403);
  });

  it('returns 404 when leaderId does not exist', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/communities').send({
      name: 'Jazz',
      type: 'Music',
      registrationStatus: 'open',
      leaderId: 99
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Leader user not found' });
  });

  it('creates a community, setting the leader as a superset of staff', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.user.findUnique.mockResolvedValue({ id: 9 } as never);
    prismaMock.community.create.mockResolvedValue(
      makeCommunity({ id: 4, staff: [] }) as never
    );
    prismaMock.consumer.upsert.mockResolvedValue({
      id: 10,
      userId: 9
    } as never);

    const res = await request(app)
      .post('/api/communities')
      .send({
        name: 'Jazz',
        type: 'Music',
        registrationStatus: 'open',
        leaderId: 9,
        staffIds: [9, 11]
      });

    expect(res.status).toBe(201);
    expect(prismaMock.community.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Jazz',
        type: 'Music',
        registrationStatus: 'open',
        image: '/images/defaults/music.png',
        leaderId: 9,
        staff: {
          connect: [{ id: 9 }, { id: 11 }]
        }
      })
    });
    expect(prismaMock.consumer.upsert).toHaveBeenCalledWith({
      where: { userId: 9 },
      create: { userId: 9, communities: { connect: { id: 4 } } },
      update: { communities: { connect: { id: 4 } } }
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'community.leader.set',
          targetType: 'community',
          targetId: 4
        })
      })
    );
  });

  it('folds the leader into staff even when omitted from staffIds', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.user.findUnique.mockResolvedValue({ id: 9 } as never);
    prismaMock.community.create.mockResolvedValue(
      makeCommunity({ id: 4, staff: [] }) as never
    );
    prismaMock.consumer.upsert.mockResolvedValue({
      id: 10,
      userId: 9
    } as never);

    const res = await request(app)
      .post('/api/communities')
      .send({
        name: 'Jazz',
        type: 'Music',
        registrationStatus: 'open',
        leaderId: 9,
        staffIds: [11]
      });

    expect(res.status).toBe(201);
    expect(prismaMock.community.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leaderId: 9,
        staff: { connect: [{ id: 11 }, { id: 9 }] }
      })
    });
  });
});

describe('PUT /api/communities/:id', () => {
  it('returns 404 when the community does not exist', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.community.findUnique.mockResolvedValue(null);

    const res = await request(app).put('/api/communities/1').send({
      name: 'Updated'
    });

    expect(res.status).toBe(404);
  });

  it('updates mutable fields and staff assignments', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.community.update.mockResolvedValue(
      makeCommunity({ name: 'Updated' }) as never
    );

    const res = await request(app)
      .put('/api/communities/1')
      .send({
        name: 'Updated',
        registrationStatus: 'invite',
        staffIds: [8, 9]
      });

    expect(res.status).toBe(200);
    expect(prismaMock.community.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        name: 'Updated',
        registrationStatus: 'invite',
        staff: { set: [{ id: 8 }, { id: 9 }] }
      }
    });
  });

  it('returns 404 when the new leaderId does not exist', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/communities/1')
      .send({ leaderId: 99 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Leader user not found' });
  });

  it('reassigns the leader and connects them to staff (transfer)', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 } as never);
    prismaMock.community.update.mockResolvedValue(
      makeCommunity({ id: 1, leaderId: 7 }) as never
    );
    prismaMock.consumer.upsert.mockResolvedValue({ id: 5, userId: 7 } as never);

    const res = await request(app)
      .put('/api/communities/1')
      .send({ leaderId: 7 });

    expect(res.status).toBe(200);
    expect(prismaMock.community.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        leaderId: 7,
        staff: { connect: { id: 7 } }
      }
    });
    expect(prismaMock.consumer.upsert).toHaveBeenCalledWith({
      where: { userId: 7 },
      create: { userId: 7, communities: { connect: { id: 1 } } },
      update: { communities: { connect: { id: 1 } } }
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'community.leader.set',
          targetType: 'community',
          targetId: 1
        })
      })
    );
  });

  it('folds the new leader into a replaced staff set', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 } as never);
    prismaMock.community.update.mockResolvedValue(
      makeCommunity({ id: 1, leaderId: 7 }) as never
    );
    prismaMock.consumer.upsert.mockResolvedValue({ id: 5, userId: 7 } as never);

    const res = await request(app)
      .put('/api/communities/1')
      .send({ leaderId: 7, staffIds: [8, 9] });

    expect(res.status).toBe(200);
    expect(prismaMock.community.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        leaderId: 7,
        staff: { set: [{ id: 8 }, { id: 9 }, { id: 7 }] }
      }
    });
  });
});

describe('DELETE /api/communities/:id', () => {
  it('returns 404 when the community does not exist', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.community.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/communities/1');

    expect(res.status).toBe(404);
  });

  it('deletes the community for admins', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.community.delete.mockResolvedValue(makeCommunity() as never);

    const res = await request(app).delete('/api/communities/1');

    expect(res.status).toBe(204);
    expect(prismaMock.community.delete).toHaveBeenCalledWith({
      where: { id: 1 }
    });
  });
});
