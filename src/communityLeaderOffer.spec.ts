import { CommunityType, RegistrationStatus } from '@prisma/client';
import {
  app,
  prismaMock,
  request,
  resetApiTestState
} from './test/apiTestHarness';

// The rules run against a real database in
// integration/communityLeaderOffer.integration.ts; this pins the route wiring.

const community = (leaderId: number | null) => ({
  id: 1,
  leaderId,
  registrationStatus: RegistrationStatus.open,
  type: CommunityType.Music,
  // GET /:id's roster reads these off the same mocked findUnique.
  curators: [],
  leader: null,
  consumers: [],
  contributors: []
});

beforeEach(() => resetApiTestState());

describe('POST /api/communities/:id/leader-offer', () => {
  it('validates the body', async () => {
    const res = await request(app)
      .post('/api/communities/1/leader-offer')
      .send({ userId: 'x' });

    expect(res.status).toBe(400);
  });

  it('refuses a caller who is not the leader, writing nothing', async () => {
    prismaMock.community.findUnique.mockResolvedValue(community(9) as never);

    const res = await request(app)
      .post('/api/communities/1/leader-offer')
      .send({ userId: 8 });

    expect(res.status).toBe(403);
    expect(prismaMock.community.updateMany).not.toHaveBeenCalled();
  });

  it('answers 204 once the offer lands', async () => {
    prismaMock.community.findUnique.mockResolvedValue(community(7) as never);
    prismaMock.community.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/communities/1/leader-offer')
      .send({ userId: 8 });

    expect(res.status).toBe(204);
  });
});

describe('POST /api/communities/:id/leader-offer/accept', () => {
  it('answers 404 with no offer to the caller', async () => {
    prismaMock.community.findUnique.mockResolvedValue(community(9) as never);
    prismaMock.community.findFirst.mockResolvedValue(null);

    const res = await request(app).post(
      '/api/communities/1/leader-offer/accept'
    );

    expect(res.status).toBe(404);
    expect(prismaMock.community.updateMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/communities/:id leaderOffer', () => {
  const offer = (toId: number) => ({
    leaderOfferedAt: new Date('2026-10-01T00:00:00Z'),
    leaderOfferTo: { id: toId, username: `u${toId}` }
  });

  it('is null for a member who is neither party', async () => {
    prismaMock.community.findUnique.mockResolvedValue(community(9) as never);
    prismaMock.community.findFirst.mockResolvedValue(offer(8) as never);

    const res = await request(app).get('/api/communities/1');

    expect(res.status).toBe(200);
    expect(res.body.leaderOffer).toBeNull();
  });

  it('is the offer for its successor', async () => {
    prismaMock.community.findUnique.mockResolvedValue(community(9) as never);
    prismaMock.community.findFirst.mockResolvedValue(offer(7) as never);

    const res = await request(app).get('/api/communities/1');

    expect(res.body.leaderOffer).toEqual({
      to: { id: 7, username: 'u7' },
      offeredAt: '2026-10-01T00:00:00.000Z'
    });
  });
});
