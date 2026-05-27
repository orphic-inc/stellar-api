const prismaMock = {
  community: { findUnique: jest.fn() },
  consumer: { findFirst: jest.fn() },
  contributor: { findFirst: jest.fn() },
  release: { findMany: jest.fn(), count: jest.fn() }
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock
}));

import { RegistrationStatus } from '@prisma/client';
import { listCommunityReleases } from './releaseBrowse';

describe('releaseBrowse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns paginated releases for accessible communities', async () => {
    prismaMock.community.findUnique.mockResolvedValue({
      registrationStatus: RegistrationStatus.open
    } as never);
    prismaMock.release.findMany.mockResolvedValue([
      {
        id: 3,
        title: 'Kind of Blue',
        releaseTags: [{ tag: { id: 7, name: 'jazz', occurrences: 9 } }]
      }
    ] as never);
    prismaMock.release.count.mockResolvedValue(1);

    const result = await listCommunityReleases({
      actorId: 7,
      communityId: 1,
      page: 2,
      limit: 25
    });

    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { communityId: 1 },
        skip: 25,
        take: 25
      })
    );
    expect(result.total).toBe(1);
    expect(result.data[0].tags).toEqual([
      { id: 7, name: 'jazz', occurrences: 9 }
    ]);
  });
});
