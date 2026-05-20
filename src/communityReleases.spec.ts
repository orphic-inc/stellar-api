import { FileType, RegistrationStatus } from '@prisma/client';
import {
  addContributionToReleaseMock,
  app,
  makeUserRank,
  prismaMock,
  request,
  resetApiTestState
} from './test/apiTestHarness';

const makeCommunity = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  registrationStatus: RegistrationStatus.open,
  allowDuplicateFormats: false,
  ...overrides
});

const makeRelease = (overrides: Record<string, unknown> = {}) => ({
  id: 3,
  communityId: 1,
  artistId: 2,
  title: 'Kind of Blue',
  description: 'Classic',
  type: 'Music',
  releaseType: 'Album',
  year: 1959,
  image: null,
  isEdition: false,
  edition: null,
  artist: { id: 2, name: 'Miles Davis' },
  tags: [{ id: 7, name: 'jazz' }],
  voteAggregate: null,
  contributions: [],
  _count: { contributions: 0 },
  ...overrides
});

beforeEach(() => resetApiTestState());

describe('GET /api/communities/:communityId/releases', () => {
  it('returns 404 when the community is missing', async () => {
    prismaMock.community.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/communities/1/releases');

    expect(res.status).toBe(404);
  });

  it('returns 403 when the user is not a member of a restricted community', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ registrationStatus: RegistrationStatus.invite }) as never
    );
    prismaMock.consumer.findFirst.mockResolvedValue(null);
    prismaMock.contributor.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/communities/1/releases');

    expect(res.status).toBe(403);
  });

  it('returns paginated releases for members', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findMany.mockResolvedValue([makeRelease()] as never);
    prismaMock.release.count.mockResolvedValue(1);

    const res = await request(app).get('/api/communities/1/releases?page=2');

    expect(res.status).toBe(200);
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { communityId: 1 },
        skip: 25,
        take: 25
      })
    );
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/communities/:communityId/releases/:releaseId', () => {
  it('returns 404 when the release is not found', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue(null);
    prismaMock.releaseVote.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/communities/1/releases/3');

    expect(res.status).toBe(404);
  });

  it('returns release detail and myVote mapping', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue(makeRelease() as never);
    prismaMock.releaseVote.findUnique.mockResolvedValue({
      positive: true
    } as never);

    const res = await request(app).get('/api/communities/1/releases/3');

    expect(res.status).toBe(200);
    expect(res.body.myVote).toBe('up');
    expect(res.body.title).toBe('Kind of Blue');
  });
});

describe('POST /api/communities/:communityId/releases', () => {
  it('requires communities_manage permission', async () => {
    const res = await request(app).post('/api/communities/1/releases').send({
      artistId: 2,
      title: 'Kind of Blue',
      description: 'Classic',
      type: 'Music',
      releaseType: 'Album',
      year: 1959
    });

    expect(res.status).toBe(403);
  });

  it('returns 404 when the community does not exist', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.community.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/communities/1/releases').send({
      artistId: 2,
      title: 'Kind of Blue',
      description: 'Classic',
      type: 'Music',
      releaseType: 'Album',
      year: 1959
    });

    expect(res.status).toBe(404);
  });

  it('creates releases with optional tags and null image', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.create.mockResolvedValue(makeRelease() as never);

    const res = await request(app)
      .post('/api/communities/1/releases')
      .send({
        artistId: 2,
        title: 'Kind of Blue',
        description: 'Classic',
        type: 'Music',
        releaseType: 'Album',
        year: 1959,
        tagIds: [7, 9]
      });

    expect(res.status).toBe(201);
    expect(prismaMock.release.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        artistId: 2,
        communityId: 1,
        image: null,
        tags: { connect: [{ id: 7 }, { id: 9 }] }
      }),
      include: { artist: true, tags: true }
    });
  });
});

describe('PUT /api/communities/:communityId/releases/:releaseId', () => {
  it('returns 404 when the release does not exist', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.release.findFirst.mockResolvedValue(null);

    const res = await request(app).put('/api/communities/1/releases/3').send({
      title: 'Updated'
    });

    expect(res.status).toBe(404);
  });

  it('updates mutable fields and tag sets', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.release.findFirst.mockResolvedValue(makeRelease() as never);
    prismaMock.release.update.mockResolvedValue(
      makeRelease({ title: 'Updated' }) as never
    );

    const res = await request(app)
      .put('/api/communities/1/releases/3')
      .send({
        title: 'Updated',
        tagIds: [8]
      });

    expect(res.status).toBe(200);
    expect(prismaMock.release.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: {
        title: 'Updated',
        tags: { set: [{ id: 8 }] }
      },
      include: { artist: true, tags: true }
    });
  });
});

describe('POST /api/communities/:communityId/releases/:releaseId/contributions', () => {
  const validPayload = {
    fileType: 'flac',
    sizeInBytes: 1234,
    downloadUrl: 'https://approved.example/file.zip',
    releaseDescription: 'Seeded from archive'
  };

  it('rejects invalid URLs when approved domains are enforced', async () => {
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: ['approved.example'],
      registrationStatus: 'open',
      maxUsers: 7000,
      dismissedLaunchChecklist: [],
      updatedAt: new Date()
    });

    const res = await request(app)
      .post('/api/communities/1/releases/3/contributions')
      .send({ ...validPayload, downloadUrl: 'not-a-url' });

    expect(res.status).toBe(400);
  });

  it('rejects unapproved domains', async () => {
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: ['approved.example'],
      registrationStatus: 'open',
      maxUsers: 7000,
      dismissedLaunchChecklist: [],
      updatedAt: new Date()
    });

    const res = await request(app)
      .post('/api/communities/1/releases/3/contributions')
      .send({ ...validPayload, downloadUrl: 'https://evil.example/file.zip' });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate formats when the community disallows them', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ allowDuplicateFormats: false }) as never
    );
    prismaMock.contribution.findFirst.mockResolvedValue({
      id: 11,
      releaseId: 3,
      type: FileType.flac
    } as never);

    const res = await request(app)
      .post('/api/communities/1/releases/3/contributions')
      .send(validPayload);

    expect(res.status).toBe(409);
  });

  it('returns 404 when the community is missing', async () => {
    prismaMock.community.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/communities/1/releases/3/contributions')
      .send(validPayload);

    expect(res.status).toBe(404);
  });

  it('returns 404 when addContributionToRelease cannot find the release', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ allowDuplicateFormats: true }) as never
    );
    addContributionToReleaseMock.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/communities/1/releases/3/contributions')
      .send(validPayload);

    expect(res.status).toBe(404);
  });

  it('creates a contribution for valid input', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ allowDuplicateFormats: true }) as never
    );
    addContributionToReleaseMock.mockResolvedValue({
      id: 15,
      releaseId: 3,
      userId: 7,
      type: FileType.flac
    } as never);

    const res = await request(app)
      .post('/api/communities/1/releases/3/contributions')
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(addContributionToReleaseMock).toHaveBeenCalledWith({
      userId: 7,
      communityId: 1,
      releaseId: 3,
      input: expect.objectContaining({ fileType: 'flac' })
    });
  });
});

describe('POST /api/communities/:communityId/releases/:releaseId/vote', () => {
  it('returns 404 when the release does not exist', async () => {
    prismaMock.release.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/communities/1/releases/3/vote')
      .send({ positive: true });

    expect(res.status).toBe(404);
  });

  it('upserts the vote and returns aggregate state', async () => {
    prismaMock.release.findUnique.mockResolvedValue({ id: 3 } as never);
    prismaMock.releaseVote.upsert.mockResolvedValue({} as never);
    prismaMock.releaseVote.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);
    prismaMock.releaseVoteAggregate.upsert.mockResolvedValue({} as never);
    prismaMock.releaseVoteAggregate.findUnique.mockResolvedValue({
      releaseId: 3,
      ups: 2,
      total: 3,
      score: 0.5
    } as never);

    const res = await request(app)
      .post('/api/communities/1/releases/3/vote')
      .send({ positive: true });

    expect(res.status).toBe(200);
    expect(res.body.myVote).toBe('up');
    expect(prismaMock.releaseVote.upsert).toHaveBeenCalledWith({
      where: { releaseId_userId: { releaseId: 3, userId: 7 } },
      create: { releaseId: 3, userId: 7, positive: true },
      update: { positive: true }
    });
  });
});

describe('DELETE /api/communities/:communityId/releases/:releaseId/vote', () => {
  it('clears the vote and returns updated aggregate', async () => {
    prismaMock.releaseVote.deleteMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.releaseVote.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.releaseVoteAggregate.upsert.mockResolvedValue({} as never);
    prismaMock.releaseVoteAggregate.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/communities/1/releases/3/vote');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ myVote: null, voteAggregate: null });
  });
});

describe('POST /api/communities/:communityId/releases/:releaseId/tags', () => {
  it('returns 404 when the release is missing', async () => {
    prismaMock.release.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/communities/1/releases/3/tags')
      .send({ name: 'fusion' });

    expect(res.status).toBe(404);
  });

  it('returns 409 when the release already has the tag', async () => {
    prismaMock.release.findFirst.mockResolvedValue({
      id: 3,
      tags: [{ id: 7 }]
    } as never);

    const res = await request(app)
      .post('/api/communities/1/releases/3/tags')
      .send({ name: 'jazz' });

    expect(res.status).toBe(409);
  });

  it('creates and attaches a tag transactionally', async () => {
    prismaMock.release.findFirst.mockResolvedValue({
      id: 3,
      tags: []
    } as never);
    prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.tag.upsert.mockResolvedValue({ id: 9, name: 'fusion' } as never);
    prismaMock.release.update.mockResolvedValue(makeRelease() as never);

    const res = await request(app)
      .post('/api/communities/1/releases/3/tags')
      .send({ name: 'fusion' });

    expect(res.status).toBe(201);
    expect(prismaMock.tag.upsert).toHaveBeenCalledWith({
      where: { name: 'fusion' },
      create: { name: 'fusion', occurrences: 1 },
      update: { occurrences: { increment: 1 } }
    });
  });
});

describe('DELETE /api/communities/:communityId/releases/:releaseId/tags/:tagId', () => {
  it('returns 404 when the release/tag relation is missing', async () => {
    prismaMock.release.findFirst.mockResolvedValue(null);

    const res = await request(app).delete(
      '/api/communities/1/releases/3/tags/9'
    );

    expect(res.status).toBe(404);
  });

  it('disconnects the tag and decrements occurrences', async () => {
    prismaMock.release.findFirst.mockResolvedValue({ id: 3 } as never);
    prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.release.update.mockResolvedValue(makeRelease() as never);
    prismaMock.tag.update.mockResolvedValue({ id: 9 } as never);

    const res = await request(app).delete(
      '/api/communities/1/releases/3/tags/9'
    );

    expect(res.status).toBe(204);
    expect(prismaMock.tag.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { occurrences: { decrement: 1 } }
    });
  });
});

describe('DELETE /api/communities/:communityId/releases/:releaseId', () => {
  it('requires communities_manage permission', async () => {
    const res = await request(app).delete('/api/communities/1/releases/3');
    expect(res.status).toBe(403);
  });

  it('returns 404 when the release is missing', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.release.findFirst.mockResolvedValue(null);

    const res = await request(app).delete('/api/communities/1/releases/3');

    expect(res.status).toBe(404);
  });

  it('deletes the release for admins', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.release.findFirst.mockResolvedValue(makeRelease() as never);
    prismaMock.release.delete.mockResolvedValue(makeRelease() as never);

    const res = await request(app).delete('/api/communities/1/releases/3');

    expect(res.status).toBe(204);
    expect(prismaMock.release.delete).toHaveBeenCalledWith({
      where: { id: 3 }
    });
  });
});
