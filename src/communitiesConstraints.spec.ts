/**
 * #564 on /communities — nine sites, and most of them relation writes.
 *
 * The membership and curator routes `connect`/`disconnect` by id, which raises
 * P2025 when either side has gone. Neither code says WHICH side, so those
 * messages name both rather than guessing.
 *
 * A separate spec file: appending would push src/communities.spec.ts toward
 * Codacy's 1000-line file limit.
 */
import {
  AnnounceVisibility,
  CommunityType,
  Prisma,
  RegistrationStatus
} from '@prisma/client';
import {
  app,
  makeUserRank,
  prismaMock,
  request,
  resetApiTestState
} from './test/apiTestHarness';

const err = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });

const community = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Jazz',
  description: 'Jazz community',
  image: '/images/defaults/music.png',
  type: CommunityType.Music,
  registrationStatus: RegistrationStatus.open,
  announceVisibility: AnnounceVisibility.PUBLIC,
  allowDuplicateFormats: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  curators: [],
  leaderId: null,
  leader: null,
  consumers: [],
  contributors: [],
  _count: { contributors: 0, releases: 0, consumers: 0 },
  ...overrides
});

beforeEach(() => {
  resetApiTestState();
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({ communities_manage: true, dnc_manage: true })
  );
});

describe('communities — a name already in use answers 409, not 500 (#564)', () => {
  // `Community.name` carries a unique constraint, so a duplicate raised P2002
  // and reported a client mistake as a server error.
  it('POST /communities', async () => {
    prismaMock.community.create.mockRejectedValue(err('P2002'));

    const res = await request(app).post('/api/communities').send({
      name: 'Jazz',
      type: CommunityType.Music,
      registrationStatus: RegistrationStatus.open
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      msg: 'A community with that name already exists'
    });
  });

  it('PUT /communities/:id', async () => {
    prismaMock.community.findUnique.mockResolvedValue(community() as never);
    prismaMock.community.update.mockRejectedValue(err('P2002'));

    const res = await request(app)
      .put('/api/communities/1')
      .send({ name: 'Taken' });

    expect(res.status).toBe(409);
  });
});

describe('communities — a dangling leader answers 404, not 500 (#564)', () => {
  // `leaderId` is a BODY id, which the general rule answers 400 — but this route
  // already answers 404 from its own read above, and a route contradicting
  // itself is worse than the rule bending.
  it('POST /communities', async () => {
    // The read must succeed, or this 404s before reaching the guard and would
    // pass for the wrong reason.
    prismaMock.user.findUnique.mockResolvedValue({ id: 999999 } as never);
    prismaMock.community.create.mockRejectedValue(err('P2003'));

    const res = await request(app).post('/api/communities').send({
      name: 'New',
      type: CommunityType.Music,
      registrationStatus: RegistrationStatus.open,
      leaderId: 999999
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Leader user not found' });
  });
});

describe('communities — a row that vanishes answers 404, not 500 (#564)', () => {
  it('DELETE /communities/:id', async () => {
    prismaMock.community.findUnique.mockResolvedValue(community() as never);
    prismaMock.community.delete.mockRejectedValue(err('P2025'));

    const res = await request(app).delete('/api/communities/1');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Community not found' });
  });

  it('PUT /communities/:id', async () => {
    prismaMock.community.findUnique.mockResolvedValue(community() as never);
    prismaMock.community.update.mockRejectedValue(err('P2025'));

    const res = await request(app)
      .put('/api/communities/1')
      .send({ description: 'x' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Community not found' });
  });

  it('DELETE /communities/:communityId/dnc/:dncId', async () => {
    prismaMock.doNotContribute.findFirst.mockResolvedValue({
      id: 3,
      communityId: 1
    } as never);
    prismaMock.doNotContribute.delete.mockRejectedValue(err('P2025'));

    const res = await request(app).delete('/api/communities/1/dnc/3');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'DNC entry not found' });
  });

  it('POST /communities/:communityId/dnc when the community went away', async () => {
    prismaMock.community.findUnique.mockResolvedValue(community() as never);
    prismaMock.doNotContribute.create.mockRejectedValue(err('P2003'));

    const res = await request(app)
      .post('/api/communities/1/dnc')
      .send({ name: 'Some Artist' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Community not found' });
  });

  it('still propagates an error that is not a constraint violation', async () => {
    prismaMock.community.findUnique.mockResolvedValue(community() as never);
    prismaMock.community.delete.mockRejectedValue(new Error('connection lost'));

    const res = await request(app).delete('/api/communities/1');

    expect(res.status).toBe(500);
  });
});
