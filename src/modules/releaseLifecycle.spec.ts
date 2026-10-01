import { Prisma } from '@prisma/client';

const prismaMock = {
  artist: { count: jest.fn() },
  community: { findUnique: jest.fn() },
  release: {
    create: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    delete: jest.fn()
  },
  comment: { deleteMany: jest.fn() },
  bookmarkRelease: { deleteMany: jest.fn() },
  releaseArtist: { deleteMany: jest.fn() },
  edition: { deleteMany: jest.fn() },
  collage: { updateMany: jest.fn() },
  auditLog: { create: jest.fn() },
  groupLog: { create: jest.fn() },
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
    prismaMock.artist.count.mockResolvedValue(1);
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
        credits: { create: [{ artistId: 2, role: 'Main', addedById: 7 }] },
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

  describe('deleteCommunityRelease (#793)', () => {
    const remove = () =>
      deleteCommunityRelease({ actorId: 7, communityId: 1, releaseId: 3 });

    const ghost = (overrides: Record<string, unknown> = {}) => {
      prismaMock.release.updateMany.mockResolvedValue({ count: 1 } as never);
      prismaMock.release.findUniqueOrThrow.mockResolvedValue({
        title: 'Kind of Blue',
        releaseGroupId: null,
        releaseTags: [],
        collageEntries: [],
        ...overrides
      } as never);
    };

    it('claims only a release in the community with no contributions', async () => {
      ghost();
      await remove();
      expect(prismaMock.release.updateMany).toHaveBeenCalledWith({
        where: { id: 3, communityId: 1, contributions: { none: {} } },
        data: { updatedAt: expect.any(Date) }
      });
    });

    it('deletes the rows a Restrict would block on, then the release', async () => {
      ghost();
      await remove();
      for (const model of [
        prismaMock.comment,
        prismaMock.bookmarkRelease,
        prismaMock.releaseArtist,
        prismaMock.edition
      ]) {
        expect(model.deleteMany).toHaveBeenCalledWith({
          where: { releaseId: 3 }
        });
      }
      expect(prismaMock.release.delete).toHaveBeenCalledWith({
        where: { id: 3 }
      });
    });

    it('decrements tag occurrences and collage entry counts', async () => {
      ghost({
        releaseTags: [{ tagId: 7 }],
        collageEntries: [{ collageId: 4 }, { collageId: 5 }]
      });
      await remove();
      expect(prismaMock.tag.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { occurrences: { decrement: 1 } }
      });
      expect(prismaMock.collage.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [4, 5] } },
        data: { numEntries: { decrement: 1 } }
      });
    });

    it('touches no collage when the release is in none', async () => {
      ghost();
      await remove();
      expect(prismaMock.collage.updateMany).not.toHaveBeenCalled();
    });

    it('writes an audit row, and no group log outside a group', async () => {
      ghost();
      await remove();
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 7,
          action: 'release.delete',
          targetType: 'Release',
          targetId: 3,
          metadata: {
            communityId: 1,
            title: 'Kind of Blue',
            releaseGroupId: null
          }
        }
      });
      expect(prismaMock.groupLog.create).not.toHaveBeenCalled();
    });

    it("logs the deletion on the release's group", async () => {
      ghost({ releaseGroupId: 9 });
      await remove();
      expect(prismaMock.groupLog.create).toHaveBeenCalledWith({
        data: {
          releaseGroupId: 9,
          userId: 7,
          info: 'Deleted release "Kind of Blue" (#3).'
        }
      });
    });
  });
});

// The constraint guards (#596, ADR-0048), each proved by failing its write
// with the code it translates.
describe('releaseLifecycle guards', () => {
  const prismaErr = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('boom', {
      code,
      clientVersion: 'test'
    });
  const refusal = (statusCode: number, message: string) =>
    expect.objectContaining({ statusCode, message });

  const create = () =>
    createCommunityRelease({
      actorId: 7,
      communityId: 1,
      data: {
        credits: [{ artistId: 2, role: 'Main' as never }],
        title: 'Kind of Blue',
        description: 'Classic',
        type: 'Music' as never,
        releaseType: 'Album' as never,
        year: 1959,
        image: undefined,
        tagIds: []
      }
    });

  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.community.findUnique.mockResolvedValue({ id: 1 } as never);
    prismaMock.artist.count.mockResolvedValue(1);
  });

  it('answers 400 for a credited artist id that names nothing, before any write', async () => {
    prismaMock.artist.count.mockResolvedValue(0);
    await expect(create()).rejects.toEqual(
      refusal(400, 'A credited artist id names nothing')
    );
    expect(prismaMock.release.create).not.toHaveBeenCalled();
  });

  it('answers 400 for an artist credited twice in one role', async () => {
    prismaMock.release.create.mockRejectedValue(prismaErr('P2002'));
    await expect(create()).rejects.toEqual(
      refusal(400, 'An artist is credited twice in the same role')
    );
  });

  it('answers the missing-community 404 when the community went mid-request', async () => {
    prismaMock.release.create.mockRejectedValue(prismaErr('P2003'));
    await expect(create()).rejects.toEqual(refusal(404, 'Community not found'));
    expect(prismaMock.releaseHistory.create).not.toHaveBeenCalled();
  });

  describe('deleteCommunityRelease', () => {
    const remove = () =>
      deleteCommunityRelease({ actorId: 7, communityId: 1, releaseId: 3 });

    beforeEach(() => {
      prismaMock.release.updateMany.mockResolvedValue({ count: 1 } as never);
      prismaMock.release.findUniqueOrThrow.mockResolvedValue({
        title: 'Kind of Blue',
        releaseGroupId: null,
        releaseTags: [],
        collageEntries: []
      } as never);
    });

    it('answers 404 when no release with that id is in the community', async () => {
      prismaMock.release.updateMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.release.count.mockResolvedValue(0);
      await expect(remove()).rejects.toEqual(refusal(404, 'Release not found'));
      expect(prismaMock.release.delete).not.toHaveBeenCalled();
    });

    it('answers 409 when the release has a contribution', async () => {
      prismaMock.release.updateMany.mockResolvedValue({ count: 0 } as never);
      prismaMock.release.count.mockResolvedValue(1);
      await expect(remove()).rejects.toEqual(
        refusal(409, 'A release with contributions cannot be deleted')
      );
      expect(prismaMock.edition.deleteMany).not.toHaveBeenCalled();
    });

    it('answers 404 when a concurrent delete won', async () => {
      prismaMock.release.delete.mockRejectedValue(prismaErr('P2025'));
      await expect(remove()).rejects.toEqual(refusal(404, 'Release not found'));
    });

    // A contribution that lands after the claim meets the Restrict (#793).
    it('answers 409 when a contribution landed after the claim', async () => {
      prismaMock.edition.deleteMany.mockRejectedValue(prismaErr('P2003'));
      await expect(remove()).rejects.toEqual(
        refusal(409, 'A release with contributions cannot be deleted')
      );
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });
  });
});
