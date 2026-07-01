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
  title: 'Kind of Blue',
  description: 'Classic',
  type: 'Music',
  releaseType: 'Album',
  year: 1959,
  image: null,
  credits: [{ role: 'Main', artist: { id: 2, name: 'Miles Davis' } }],
  tags: [{ id: 7, name: 'jazz', occurrences: 9 }],
  releaseTags: [
    {
      id: 77,
      tagId: 7,
      positiveVotes: 3,
      negativeVotes: 1,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      tag: { id: 7, name: 'jazz', occurrences: 9 },
      user: { id: 7, username: 'user' },
      votes: []
    }
  ],
  historyEntries: [],
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
    prismaMock.release.findFirst.mockResolvedValue(
      makeRelease({
        releaseTags: [
          {
            id: 77,
            positiveVotes: 5,
            negativeVotes: 2,
            createdAt: new Date('2024-01-01T00:00:00Z'),
            tag: { id: 7, name: 'jazz', occurrences: 9 },
            user: { id: 11, username: 'tagger' },
            votes: [{ direction: 'up' }]
          }
        ],
        historyEntries: [
          {
            id: 91,
            summary: 'Tag "jazz" added',
            action: 'tag_added',
            changedFields: ['tags'],
            before: null,
            after: null,
            createdAt: new Date('2024-01-02T00:00:00Z'),
            actor: { id: 11, username: 'tagger' }
          }
        ]
      }) as never
    );
    prismaMock.releaseVote.findUnique.mockResolvedValue({
      positive: true
    } as never);

    const res = await request(app).get('/api/communities/1/releases/3');

    expect(res.status).toBe(200);
    expect(res.body.myVote).toBe('up');
    expect(res.body.title).toBe('Kind of Blue');
    expect(res.body.releaseTags[0]).toMatchObject({
      name: 'jazz',
      score: 3,
      positiveVotes: 4,
      negativeVotes: 1,
      myVotes: { up: true, down: false }
    });
    expect(res.body.historyEntries[0].summary).toBe('Tag "jazz" added');
    expect(res.body.isContributor).toBe(false);
  });

  it('returns isContributor true when the current user has a contribution', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue(
      makeRelease({
        contributions: [{ id: 5, userId: 7 }]
      }) as never
    );
    prismaMock.releaseVote.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/communities/1/releases/3');

    expect(res.status).toBe(200);
    expect(res.body.isContributor).toBe(true);
  });
});

describe('GET /api/communities/:communityId/releases/:releaseId/contributions', () => {
  const makeQualityContribution = (
    overrides: Record<string, unknown> = {}
  ) => ({
    id: 15,
    userId: 7,
    releaseId: 3,
    contributorId: 4,
    releaseDescription: 'Lossless rip',
    downloadUrl: 'https://example.com/kob.torrent',
    // BigInt on the wire proves the number-normalization contract.
    sizeInBytes: BigInt('5000000000'),
    linkStatus: 'PASS',
    linkCheckedAt: null,
    type: FileType.flac,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    user: { id: 7, username: 'user' },
    collaborators: [{ id: 2, name: 'Miles Davis' }],
    releaseFile: {
      bitrate: 'Lossless',
      hasLog: true,
      hasCue: true,
      isScene: false
    },
    edition: {
      id: 8,
      media: 'CD',
      year: 1997,
      recordLabel: 'Columbia',
      catalogueNumber: 'CL 1355',
      title: 'Legacy Edition',
      isRemaster: true,
      isUnknownEdition: false
    },
    ...overrides
  });

  it('returns contributions with rip-quality and edition identity', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue({ id: 3 } as never);
    prismaMock.contribution.findMany.mockResolvedValue([
      makeQualityContribution()
    ] as never);

    const res = await request(app).get(
      '/api/communities/1/releases/3/contributions'
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const entry = res.body[0];
    expect(entry.type).toBe('flac');
    // BigInt serialized to a JS number, not a string.
    expect(entry.sizeInBytes).toBe(5000000000);
    expect(entry.releaseFile).toEqual({
      bitrate: 'Lossless',
      hasLog: true,
      hasCue: true,
      isScene: false
    });
    expect(entry.edition.media).toBe('CD');
    expect(entry.edition.recordLabel).toBe('Columbia');
    expect(entry.edition.title).toBe('Legacy Edition');
  });

  it('returns an empty array when the release has no contributions', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue({ id: 3 } as never);
    prismaMock.contribution.findMany.mockResolvedValue([] as never);

    const res = await request(app).get(
      '/api/communities/1/releases/3/contributions'
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 404 when the release is not in the community', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue(null);

    const res = await request(app).get(
      '/api/communities/1/releases/999/contributions'
    );

    expect(res.status).toBe(404);
  });

  it('returns 403 for a non-member of a restricted community', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ registrationStatus: RegistrationStatus.invite }) as never
    );
    prismaMock.consumer.findFirst.mockResolvedValue(null);
    prismaMock.contributor.findFirst.mockResolvedValue(null);

    const res = await request(app).get(
      '/api/communities/1/releases/3/contributions'
    );

    expect(res.status).toBe(403);
  });
});

describe('POST /api/communities/:communityId/releases', () => {
  it('requires communities_manage permission', async () => {
    const res = await request(app)
      .post('/api/communities/1/releases')
      .send({
        credits: [{ artistId: 2 }],
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

    const res = await request(app)
      .post('/api/communities/1/releases')
      .send({
        credits: [{ artistId: 2 }],
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
    prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.release.create.mockResolvedValue(makeRelease() as never);
    prismaMock.tag.findMany.mockResolvedValue([
      { id: 7, name: 'jazz' },
      { id: 9, name: 'fusion' }
    ] as never);
    prismaMock.releaseTag.create.mockResolvedValue({ id: 99 } as never);
    prismaMock.release.findUniqueOrThrow.mockResolvedValue(
      makeRelease() as never
    );

    const res = await request(app)
      .post('/api/communities/1/releases')
      .send({
        credits: [{ artistId: 2 }],
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
        communityId: 1,
        image: null,
        credits: { create: [{ artistId: 2, role: 'Main' }] },
        editions: { create: { year: 1959, isUnknownEdition: true } }
      })
    });
    expect(prismaMock.tag.findMany).toHaveBeenCalledWith({
      where: { id: { in: [7, 9] } },
      select: { id: true, name: true }
    });
    expect(prismaMock.releaseTag.create).toHaveBeenCalledWith({
      data: {
        releaseId: 3,
        tagId: 7,
        userId: 7,
        positiveVotes: 3,
        negativeVotes: 1
      }
    });
    expect(prismaMock.releaseHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        releaseId: 3,
        actorId: 7,
        action: 'created',
        summary: 'Release created'
      })
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

  it('updates mutable metadata fields', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.release.findFirst
      .mockResolvedValueOnce(makeRelease() as never)
      .mockResolvedValueOnce(
        makeRelease({ title: 'Updated', releaseTags: [] }) as never
      );
    prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.release.update.mockResolvedValue(
      makeRelease({ title: 'Updated', releaseTags: [] }) as never
    );
    prismaMock.release.findUniqueOrThrow.mockResolvedValue(
      makeRelease({ title: 'Updated', releaseTags: [] }) as never
    );

    const res = await request(app)
      .put('/api/communities/1/releases/3')
      .send({ title: 'Updated' });

    expect(res.status).toBe(200);
    expect(prismaMock.release.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { title: 'Updated' }
    });
    expect(prismaMock.releaseHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        releaseId: 3,
        actorId: 7,
        action: 'edit',
        changedFields: ['title']
      })
    });
  });

  it('returns 403 when caller has no communities_manage and no contribution', async () => {
    prismaMock.release.findFirst.mockResolvedValue(makeRelease() as never);
    prismaMock.contribution.findFirst.mockResolvedValue(null);

    const res = await request(app).put('/api/communities/1/releases/3').send({
      title: 'Unauthorized Update'
    });

    expect(res.status).toBe(403);
  });

  it('allows a contributor without communities_manage to edit the release', async () => {
    prismaMock.release.findFirst
      .mockResolvedValueOnce(makeRelease() as never)
      .mockResolvedValueOnce(
        makeRelease({ title: 'Updated by Contributor' }) as never
      );
    prismaMock.contribution.findFirst.mockResolvedValue({ id: 5 } as never);
    prismaMock.release.update.mockResolvedValue(
      makeRelease({ title: 'Updated by Contributor' }) as never
    );
    prismaMock.release.findUniqueOrThrow.mockResolvedValue(
      makeRelease({ title: 'Updated by Contributor' }) as never
    );

    const res = await request(app)
      .put('/api/communities/1/releases/3')
      .send({ title: 'Updated by Contributor' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated by Contributor');
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
      installedAt: null,
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
      installedAt: null,
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
      type: FileType.flac,
      release: { id: 3, title: 'Kind of Blue', communityId: 1, artistId: 5 }
    } as never);
    prismaMock.release.findUniqueOrThrow.mockResolvedValue(
      makeRelease() as never
    );

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
    expect(prismaMock.releaseHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        releaseId: 3,
        actorId: 7,
        action: 'contribution_added',
        summary: 'flac contribution added'
      })
    });
  });

  it('emits artist_release notifications to subscribers when contribution is added', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ allowDuplicateFormats: true }) as never
    );
    addContributionToReleaseMock.mockResolvedValue({
      id: 15,
      releaseId: 3,
      userId: 7,
      type: FileType.flac,
      release: { id: 3, title: 'Kind of Blue', communityId: 1, artistId: 5 }
    } as never);
    prismaMock.releaseArtist.findMany.mockResolvedValue([
      { artistId: 5 }
    ] as never);
    prismaMock.artistSubscription.findMany.mockResolvedValue([
      { userId: 99 }
    ] as never);
    prismaMock.release.findUniqueOrThrow.mockResolvedValue(
      makeRelease() as never
    );

    const res = await request(app)
      .post('/api/communities/1/releases/3/contributions')
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(prismaMock.artistSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { artistId: { in: [5] } } })
    );
    expect(prismaMock.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            type: 'artist_release',
            page: 'contributions',
            pageId: 15
          })
        ])
      })
    );
  });
});

describe('POST /api/communities/:communityId/releases/:releaseId/vote', () => {
  it('returns 404 when the release does not exist', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/communities/1/releases/3/vote')
      .send({ positive: true });

    expect(res.status).toBe(404);
  });

  it('upserts the vote and returns aggregate state', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue({ id: 3 } as never);
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
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue({ id: 3 } as never);
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
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/communities/1/releases/3/tags')
      .send({ name: 'fusion' });

    expect(res.status).toBe(404);
  });

  it('returns 409 when the release already has the tag', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue({
      id: 3,
      releaseTags: [{ id: 17 }]
    } as never);

    const res = await request(app)
      .post('/api/communities/1/releases/3/tags')
      .send({ name: 'jazz' });

    expect(res.status).toBe(409);
  });

  it('creates and attaches a tag transactionally', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue({
      id: 3,
      releaseTags: []
    } as never);
    prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.tag.upsert.mockResolvedValue({ id: 9, name: 'fusion' } as never);
    prismaMock.release.findUniqueOrThrow.mockResolvedValue({
      id: 3,
      title: 'Kind of Blue',
      description: 'Classic',
      image: null,
      year: 1959,
      isEdition: false,
      edition: null,
      releaseTags: []
    } as never);
    prismaMock.releaseTag.create.mockResolvedValue({
      id: 19,
      positiveVotes: 3,
      negativeVotes: 1,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      tag: { id: 9, name: 'fusion', occurrences: 4 },
      user: { id: 7, username: 'user' }
    } as never);

    const res = await request(app)
      .post('/api/communities/1/releases/3/tags')
      .send({ name: 'fusion' });

    expect(res.status).toBe(201);
    expect(prismaMock.tag.upsert).toHaveBeenCalledWith({
      where: { name: 'fusion' },
      create: { name: 'fusion', occurrences: 1 },
      update: { occurrences: { increment: 1 } }
    });
    expect(prismaMock.releaseTag.create).toHaveBeenCalledWith({
      data: {
        releaseId: 3,
        tagId: 9,
        userId: 7,
        positiveVotes: 3,
        negativeVotes: 1
      }
    });
    expect(prismaMock.releaseTagVote.create).toHaveBeenCalledWith({
      data: { releaseTagId: 19, userId: 7, direction: 'up' }
    });
    expect(prismaMock.releaseHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        releaseId: 3,
        actorId: 7,
        action: 'tag_added'
      })
    });
  });
});

describe('POST /api/communities/:communityId/releases/:releaseId/tags/:tagId/vote', () => {
  it('increments an up-vote once and returns mapped tag state', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.releaseTag.findFirst.mockResolvedValue({
      id: 17,
      positiveVotes: 3,
      negativeVotes: 1
    } as never);
    prismaMock.releaseTagVote.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.releaseTag.findUniqueOrThrow.mockResolvedValue({
      id: 17,
      positiveVotes: 5,
      negativeVotes: 1,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      tag: { id: 9, name: 'fusion', occurrences: 12 },
      user: { id: 4, username: 'adder' },
      votes: [{ direction: 'up' }]
    } as never);

    const res = await request(app)
      .post('/api/communities/1/releases/3/tags/9/vote')
      .send({ direction: 'up' });

    expect(res.status).toBe(200);
    expect(prismaMock.releaseTagVote.create).toHaveBeenCalledWith({
      data: { releaseTagId: 17, userId: 7, direction: 'up' }
    });
    expect(prismaMock.releaseTag.update).toHaveBeenCalledWith({
      where: { id: 17 },
      data: { positiveVotes: { increment: 2 } }
    });
    expect(res.body).toMatchObject({
      name: 'fusion',
      score: 4,
      positiveVotes: 4,
      negativeVotes: 0,
      myVotes: { up: true, down: false }
    });
  });

  it('returns 404 when the release tag is missing', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.releaseTag.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/communities/1/releases/3/tags/9/vote')
      .send({ direction: 'up' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/communities/:communityId/releases/:releaseId/tags/:tagId', () => {
  it('requires communities_manage permission', async () => {
    const res = await request(app).delete(
      '/api/communities/1/releases/3/tags/9'
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when the release/tag relation is missing', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.release.findFirst.mockResolvedValue(null);

    const res = await request(app).delete(
      '/api/communities/1/releases/3/tags/9'
    );

    expect(res.status).toBe(404);
  });

  it('disconnects the tag and decrements occurrences', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.release.findFirst
      .mockResolvedValueOnce({ id: 3 } as never)
      .mockResolvedValueOnce(makeRelease() as never);
    prismaMock.tag.findUnique.mockResolvedValue({ name: 'jazz' } as never);
    prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.release.findUniqueOrThrow.mockResolvedValue(
      makeRelease() as never
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
    expect(prismaMock.releaseTag.deleteMany).toHaveBeenCalledWith({
      where: { releaseId: 3, tagId: 9 }
    });
    expect(prismaMock.releaseHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        releaseId: 3,
        actorId: 7,
        action: 'tag_removed'
      })
    });
  });
});

describe('GET /api/communities/:communityId/releases/:releaseId/history', () => {
  const makeHistoryEntry = (overrides: Record<string, unknown> = {}) => ({
    id: 91,
    releaseId: 3,
    actorId: 7,
    action: 'edit',
    summary: 'Title changed',
    changedFields: ['title'],
    before: { title: 'Old Title' },
    after: { title: 'New Title' },
    snapshot: null,
    createdAt: new Date('2024-06-01T00:00:00Z'),
    actor: { id: 7, username: 'user' },
    ...overrides
  });

  it('returns paginated history entries', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue({ id: 3 } as never);
    prismaMock.releaseHistory.findMany.mockResolvedValue([
      makeHistoryEntry()
    ] as never);
    prismaMock.releaseHistory.count.mockResolvedValue(1);

    const res = await request(app).get(
      '/api/communities/1/releases/3/history?page=1'
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].summary).toBe('Title changed');
    expect(res.body.meta.total).toBe(1);
    expect(prismaMock.releaseHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { releaseId: 3 },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      })
    );
  });

  it('returns 404 when the release does not exist', async () => {
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.release.findFirst.mockResolvedValue(null);

    const res = await request(app).get(
      '/api/communities/1/releases/999/history'
    );

    expect(res.status).toBe(404);
  });

  it('returns 403 when the user is not a member of a restricted community', async () => {
    prismaMock.community.findUnique.mockResolvedValue(
      makeCommunity({ registrationStatus: RegistrationStatus.invite }) as never
    );
    prismaMock.consumer.findFirst.mockResolvedValue(null);
    prismaMock.contributor.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/communities/1/releases/3/history');

    expect(res.status).toBe(403);
  });
});

describe('POST /api/communities/:communityId/releases/:releaseId/history/:historyId/revert', () => {
  const editEntry = {
    id: 91,
    releaseId: 3,
    action: 'edit',
    summary: 'Title changed',
    changedFields: ['title'],
    before: {
      title: 'Old Title',
      description: 'Classic',
      image: null,
      year: 1959,
      isEdition: false,
      edition: null,
      tagIds: [],
      tagNames: []
    },
    after: {
      title: 'Revision Title',
      description: 'Classic',
      image: null,
      year: 1959,
      isEdition: false,
      edition: null,
      tagIds: [],
      tagNames: []
    },
    snapshot: {
      title: 'Revision Title',
      description: 'Classic',
      image: null,
      year: 1959,
      isEdition: false,
      edition: null,
      tagIds: [],
      tagNames: []
    },
    createdAt: new Date('2024-06-01T00:00:00Z'),
    actorId: 7
  };

  it('requires communities_manage permission', async () => {
    const res = await request(app).post(
      '/api/communities/1/releases/3/history/91/revert'
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when the history entry is not found', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.releaseHistory.findFirst.mockResolvedValue(null);

    const res = await request(app).post(
      '/api/communities/1/releases/3/history/91/revert'
    );

    expect(res.status).toBe(404);
  });

  it('returns 422 when the history entry is not an edit action', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.releaseHistory.findFirst.mockResolvedValue({
      ...editEntry,
      action: 'created'
    } as never);

    const res = await request(app).post(
      '/api/communities/1/releases/3/history/91/revert'
    );

    expect(res.status).toBe(422);
    expect(res.body.msg).toBe('Only edit revisions can be reverted');
  });

  it('reverts the release to the selected revision snapshot and writes a revert history entry', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );
    prismaMock.community.findUnique.mockResolvedValue(makeCommunity() as never);
    prismaMock.releaseHistory.findFirst.mockResolvedValue(editEntry as never);
    prismaMock.release.findFirst.mockResolvedValue(makeRelease() as never);
    prismaMock.release.findUniqueOrThrow.mockResolvedValue(
      makeRelease({ title: 'Revision Title' }) as never
    );

    const res = await request(app).post(
      '/api/communities/1/releases/3/history/91/revert'
    );

    expect(res.status).toBe(200);
    expect(prismaMock.release.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 3 },
        data: expect.objectContaining({ title: 'Revision Title' })
      })
    );
    expect(prismaMock.releaseHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        releaseId: 3,
        actorId: 7,
        action: 'edit',
        after: expect.objectContaining({ title: 'Revision Title' }),
        summary: expect.stringContaining('Reverted to revision from')
      })
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
    prismaMock.release.findFirst.mockResolvedValue({
      id: 3,
      releaseTags: [{ tagId: 7 }]
    } as never);
    prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.release.delete.mockResolvedValue(makeRelease() as never);

    const res = await request(app).delete('/api/communities/1/releases/3');

    expect(res.status).toBe(204);
    expect(prismaMock.release.delete).toHaveBeenCalledWith({
      where: { id: 3 }
    });
    expect(prismaMock.tag.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { occurrences: { decrement: 1 } }
    });
  });
});
