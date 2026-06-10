const prismaMock = {
  community: { findUnique: jest.fn() },
  consumer: { findFirst: jest.fn() },
  contributor: { findFirst: jest.fn() },
  contribution: { findFirst: jest.fn() },
  release: {
    findFirst: jest.fn(),
    update: jest.fn(),
    findUniqueOrThrow: jest.fn()
  },
  releaseVote: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn()
  },
  releaseVoteAggregate: { findUnique: jest.fn() },
  releaseTag: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn()
  },
  releaseTagVote: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn()
  },
  releaseHistory: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn()
  },
  tag: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn()
  },
  tagAlias: { findUnique: jest.fn() },
  artistSubscription: { findMany: jest.fn() },
  releaseArtist: { findMany: jest.fn() },
  notification: { createMany: jest.fn() },
  siteSettings: { upsert: jest.fn() },
  $transaction: jest.fn()
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock
}));

jest.mock('../lib/userRankAccess', () => ({
  getUserRankAccess: jest.fn()
}));

jest.mock('./contribution', () => ({
  addContributionToRelease: jest.fn()
}));

jest.mock('./settings', () => ({
  getSettings: jest.fn()
}));

jest.mock('./top10', () => ({
  recomputeVoteAggregate: jest.fn()
}));

import { RegistrationStatus, FileType } from '@prisma/client';
import { releaseWorkbench } from './releaseWorkbench';
import { getUserRankAccess } from '../lib/userRankAccess';
import { addContributionToRelease } from './contribution';
import { getSettings } from './settings';
import { recomputeVoteAggregate } from './top10';

const getUserRankAccessMock = getUserRankAccess as jest.MockedFunction<
  typeof getUserRankAccess
>;
const addContributionToReleaseMock =
  addContributionToRelease as jest.MockedFunction<
    typeof addContributionToRelease
  >;
const getSettingsMock = getSettings as jest.MockedFunction<typeof getSettings>;
const recomputeVoteAggregateMock =
  recomputeVoteAggregate as jest.MockedFunction<typeof recomputeVoteAggregate>;

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
  releaseTags: [
    {
      id: 77,
      tagId: 7,
      positiveVotes: 3,
      negativeVotes: 1,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      tag: { id: 7, name: 'jazz', occurrences: 9 },
      user: { id: 9, username: 'tagger' },
      votes: []
    }
  ],
  voteAggregate: null,
  contributions: [],
  ...overrides
});

describe('releaseWorkbench session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.community.findUnique.mockResolvedValue({
      id: 1,
      registrationStatus: RegistrationStatus.open
    });
    prismaMock.tagAlias.findUnique.mockResolvedValue(null as never);
    prismaMock.artistSubscription.findMany.mockResolvedValue([] as never);
    prismaMock.releaseArtist.findMany.mockResolvedValue([] as never);
    getUserRankAccessMock.mockResolvedValue({
      userRankId: 1,
      effectiveLevel: 1000,
      permissions: {},
      permittedForumIds: [],
      secondaryRankIds: []
    });
    getSettingsMock.mockResolvedValue({
      id: 1,
      approvedDomains: [],
      registrationStatus: 'open',
      maxUsers: 7000,
      dismissedLaunchChecklist: [],
      updatedAt: new Date()
    } as never);
  });

  it('maps release view state through the session seam', async () => {
    prismaMock.release.findFirst.mockResolvedValue(
      makeRelease({
        releaseTags: [
          {
            id: 77,
            tagId: 7,
            positiveVotes: 5,
            negativeVotes: 2,
            createdAt: new Date('2024-01-01T00:00:00Z'),
            tag: { id: 7, name: 'jazz', occurrences: 9 },
            user: { id: 9, username: 'tagger' },
            votes: [{ direction: 'up' }]
          }
        ],
        contributions: [{ id: 5, userId: 7 }]
      }) as never
    );
    prismaMock.releaseVote.findUnique.mockResolvedValue({
      positive: true
    } as never);

    const session = await releaseWorkbench.open({
      actorId: 7,
      communityId: 1,
      releaseId: 3
    });
    const view = await session.getView();

    expect(view.myVote).toBe('up');
    expect(view.isContributor).toBe(true);
    expect(view.releaseTags[0]).toMatchObject({
      name: 'jazz',
      score: 3,
      positiveVotes: 4,
      negativeVotes: 1,
      myVotes: { up: true, down: false }
    });
  });

  it('updates metadata through the session seam', async () => {
    prismaMock.contribution.findFirst.mockResolvedValue({ id: 5 } as never);
    prismaMock.release.findFirst
      .mockResolvedValueOnce(makeRelease() as never)
      .mockResolvedValueOnce(makeRelease({ title: 'Updated' }) as never);
    prismaMock.release.update.mockResolvedValue(
      makeRelease({ title: 'Updated' }) as never
    );
    prismaMock.release.findUniqueOrThrow.mockResolvedValue(
      makeRelease({ title: 'Updated' }) as never
    );
    prismaMock.releaseVote.findUnique.mockResolvedValue(null as never);

    const session = await releaseWorkbench.open({
      actorId: 7,
      communityId: 1,
      releaseId: 3
    });
    const view = await session.updateMetadata({ title: 'Updated' });

    expect(view.release.title).toBe('Updated');
    expect(prismaMock.releaseHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        releaseId: 3,
        actorId: 7,
        action: 'edit',
        changedFields: ['title']
      })
    });
  });

  it('updates vote state through the session seam', async () => {
    prismaMock.contribution.findFirst.mockResolvedValue(null as never);
    prismaMock.release.findFirst
      .mockResolvedValueOnce({ id: 3 } as never)
      .mockResolvedValueOnce(makeRelease() as never);
    prismaMock.releaseVote.upsert.mockResolvedValue({} as never);
    prismaMock.releaseVote.findUnique.mockResolvedValue({
      positive: true
    } as never);
    prismaMock.releaseVoteAggregate.findUnique.mockResolvedValue({
      releaseId: 3,
      ups: 2,
      total: 3,
      score: 0.5
    } as never);

    const session = await releaseWorkbench.open({
      actorId: 7,
      communityId: 1,
      releaseId: 3
    });
    const view = await session.vote({ direction: 'up' });

    expect(recomputeVoteAggregateMock).toHaveBeenCalledWith(3);
    expect(view.myVote).toBe('up');
    expect(view.release.voteAggregate).toEqual({
      releaseId: 3,
      ups: 2,
      total: 3,
      score: 0.5
    });
  });

  it('adds a tag through the session seam', async () => {
    prismaMock.contribution.findFirst.mockResolvedValue(null as never);
    prismaMock.release.findFirst
      .mockResolvedValueOnce({ id: 3, releaseTags: [] } as never)
      .mockResolvedValueOnce(
        makeRelease({
          releaseTags: [
            {
              id: 81,
              tagId: 9,
              positiveVotes: 3,
              negativeVotes: 1,
              createdAt: new Date('2024-01-01T00:00:00Z'),
              tag: { id: 9, name: 'fusion', occurrences: 1 },
              user: { id: 7, username: 'user' },
              votes: []
            }
          ]
        }) as never
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
    prismaMock.releaseTag.create.mockResolvedValue({ id: 81 } as never);
    prismaMock.releaseVote.findUnique.mockResolvedValue(null as never);

    const session = await releaseWorkbench.open({
      actorId: 7,
      communityId: 1,
      releaseId: 3
    });
    const view = await session.addTag({ name: 'fusion' });

    expect(view.releaseTags[0].name).toBe('fusion');
    expect(prismaMock.releaseTagVote.create).toHaveBeenCalledWith({
      data: { releaseTagId: 81, userId: 7, direction: 'up' }
    });
  });

  it('reverts history through the session seam', async () => {
    prismaMock.contribution.findFirst.mockResolvedValue(null as never);
    prismaMock.releaseHistory.findFirst.mockResolvedValue({
      id: 91,
      releaseId: 3,
      action: 'edit',
      createdAt: new Date('2024-06-01T00:00:00Z'),
      snapshot: {
        title: 'Revision Title',
        description: 'Classic',
        image: null,
        year: 1959,
        isEdition: false,
        edition: null,
        tagIds: [7],
        tagNames: ['jazz']
      },
      after: null
    } as never);
    prismaMock.release.findFirst
      .mockResolvedValueOnce(makeRelease() as never)
      .mockResolvedValueOnce(makeRelease({ title: 'Revision Title' }) as never);
    prismaMock.release.update.mockResolvedValue(
      makeRelease({ title: 'Revision Title' }) as never
    );
    prismaMock.releaseVote.findUnique.mockResolvedValue(null as never);

    const session = await releaseWorkbench.open({
      actorId: 7,
      communityId: 1,
      releaseId: 3,
      permissions: { communities_manage: true }
    });
    const view = await session.revertHistory({ historyId: 91 });

    expect(view.release.title).toBe('Revision Title');
    expect(prismaMock.releaseHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        releaseId: 3,
        actorId: 7,
        action: 'edit'
      })
    });
  });

  it('attaches contributions through the session seam', async () => {
    prismaMock.contribution.findFirst.mockResolvedValue(null as never);
    prismaMock.community.findUnique.mockResolvedValueOnce({
      id: 1,
      registrationStatus: RegistrationStatus.open
    } as never);
    prismaMock.community.findUnique.mockResolvedValueOnce({
      id: 1,
      allowDuplicateFormats: true
    } as never);
    addContributionToReleaseMock.mockResolvedValue({
      id: 15,
      releaseId: 3,
      userId: 7,
      type: FileType.flac,
      sizeInBytes: 1234,
      user: { id: 7, username: 'user' },
      release: { id: 3, title: 'Kind of Blue', communityId: 1, artistId: 5 }
    } as never);
    prismaMock.release.findUniqueOrThrow.mockResolvedValue(
      makeRelease() as never
    );

    const session = await releaseWorkbench.open({
      actorId: 7,
      communityId: 1,
      releaseId: 3
    });
    const contribution = await session.attachContribution({
      fileType: 'flac',
      sizeInBytes: 1234,
      downloadUrl: 'https://approved.example/file.zip',
      releaseDescription: 'Seeded from archive',
      bitrate: undefined,
      media: undefined,
      hasLog: false,
      hasCue: false,
      isScene: false
    });

    expect(contribution.id).toBe(15);
    expect(prismaMock.releaseHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        releaseId: 3,
        actorId: 7,
        action: 'contribution_added'
      })
    });
  });
});
