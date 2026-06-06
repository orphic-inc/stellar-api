const prismaMock = {
  community: { findUnique: jest.fn() },
  release: {
    create: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn()
  },
  releaseTag: { create: jest.fn() },
  releaseTagVote: { create: jest.fn() },
  releaseHistory: { create: jest.fn() },
  tag: {
    findMany: jest.fn(),
    update: jest.fn()
  },
  $transaction: jest.fn()
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock
}));

import {
  createCommunityRelease,
  deleteCommunityRelease
} from './releaseLifecycle';

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
  releaseTags: [],
  ...overrides
});

describe('releaseLifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
  });

  it('creates community releases with initial tags and history', async () => {
    prismaMock.community.findUnique.mockResolvedValue({ id: 1 } as never);
    prismaMock.release.create.mockResolvedValue({ id: 3 } as never);
    prismaMock.tag.findMany.mockResolvedValue([
      { id: 7, name: 'jazz' }
    ] as never);
    prismaMock.releaseTag.create.mockResolvedValue({ id: 77 } as never);
    prismaMock.release.findUniqueOrThrow.mockResolvedValue(
      makeRelease({
        releaseTags: [{ tag: { id: 7, name: 'jazz', occurrences: 9 } }]
      }) as never
    );

    const release = await createCommunityRelease({
      actorId: 7,
      communityId: 1,
      data: {
        credits: [{ artistId: 2, role: 'Main' as never }],
        title: 'Kind of Blue',
        description: 'Classic',
        type: 'Music' as never,
        releaseType: 'Album' as never,
        year: 1959,
        tagIds: [7]
      }
    });

    expect(release.id).toBe(3);
    expect(prismaMock.release.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        communityId: 1,
        image: null,
        credits: { create: [{ artistId: 2, role: 'Main' }] },
        editions: { create: { year: 1959, isUnknownEdition: true } }
      })
    });
    expect(prismaMock.releaseHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        releaseId: 3,
        actorId: 7,
        action: 'created'
      })
    });
  });

  it('deletes community releases and decrements tag occurrences', async () => {
    prismaMock.release.findFirst.mockResolvedValue({
      id: 3,
      releaseTags: [{ tagId: 7 }]
    } as never);

    await deleteCommunityRelease({ communityId: 1, releaseId: 3 });

    expect(prismaMock.tag.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { occurrences: { decrement: 1 } }
    });
    expect(prismaMock.release.delete).toHaveBeenCalledWith({
      where: { id: 3 }
    });
  });
});
