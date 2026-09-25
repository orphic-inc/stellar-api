import { CommunityType, RegistrationStatus } from '@prisma/client';
import {
  app,
  prismaMock,
  request,
  resetApiTestState
} from './test/apiTestHarness';

// #709, ADR-0050: a curator admits a member as a consumer or a contributor.
// Admitting only as a consumer made `Consumer` stand in for membership, the
// category error ADR-0033 names. Split from communities.spec.ts to keep that
// file's size where it was.

const curatedCommunity = () =>
  ({
    id: 1,
    name: 'Jazz',
    type: CommunityType.Music,
    registrationStatus: RegistrationStatus.closed,
    curators: [{ id: 7 }],
    leaderId: null
  }) as never;

beforeEach(() => {
  resetApiTestState();
  prismaMock.community.findUnique.mockResolvedValue(curatedCommunity());
  prismaMock.user.findUnique.mockResolvedValue({ id: 8 } as never);
});

describe('POST /api/communities/:id/members — role (#709)', () => {
  it('admits a contributor when asked', async () => {
    prismaMock.contributor.upsert.mockResolvedValue({
      id: 4,
      userId: 8
    } as never);

    const res = await request(app)
      .post('/api/communities/1/members')
      .send({ userId: 8, role: 'contributor' });

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(prismaMock.contributor.upsert).toHaveBeenCalledWith({
      where: { userId: 8 },
      create: { userId: 8, communities: { connect: { id: 1 } } },
      update: { communities: { connect: { id: 1 } } }
    });
    expect(prismaMock.consumer.upsert).not.toHaveBeenCalled();
  });

  it('still admits a consumer when no role is given', async () => {
    prismaMock.consumer.upsert.mockResolvedValue({ id: 9, userId: 8 } as never);

    const res = await request(app)
      .post('/api/communities/1/members')
      .send({ userId: 8 });

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(prismaMock.consumer.upsert).toHaveBeenCalled();
    expect(prismaMock.contributor.upsert).not.toHaveBeenCalled();
  });

  it('rejects an unknown role', async () => {
    const res = await request(app)
      .post('/api/communities/1/members')
      .send({ userId: 8, role: 'curator' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/communities/:id/members/:userId — both roles (#709)', () => {
  it('removes the member from both roles', async () => {
    prismaMock.consumer.findUnique.mockResolvedValue({
      id: 9,
      userId: 8
    } as never);
    prismaMock.contributor.findUnique.mockResolvedValue({
      id: 4,
      userId: 8
    } as never);

    const res = await request(app).delete('/api/communities/1/members/8');

    expect(res.status).toBe(204);
    expect(prismaMock.consumer.update).toHaveBeenCalledWith({
      where: { userId: 8 },
      data: { communities: { disconnect: { id: 1 } } }
    });
    expect(prismaMock.contributor.update).toHaveBeenCalledWith({
      where: { userId: 8 },
      data: { communities: { disconnect: { id: 1 } } }
    });
  });

  it('removes a contributor who never consumed', async () => {
    prismaMock.consumer.findUnique.mockResolvedValue(null);
    prismaMock.contributor.findUnique.mockResolvedValue({
      id: 4,
      userId: 8
    } as never);

    const res = await request(app).delete('/api/communities/1/members/8');

    expect(res.status).toBe(204);
    expect(prismaMock.contributor.update).toHaveBeenCalled();
    expect(prismaMock.consumer.update).not.toHaveBeenCalled();
  });

  it('answers 404 when the user holds neither role', async () => {
    prismaMock.consumer.findUnique.mockResolvedValue(null);
    prismaMock.contributor.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/communities/1/members/8');

    expect(res.status).toBe(404);
  });
});
