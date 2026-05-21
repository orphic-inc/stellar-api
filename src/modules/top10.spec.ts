const prismaMock = {
  tag: {
    findMany: jest.fn()
  },
  releaseTag: {
    findMany: jest.fn()
  },
  release: {
    findMany: jest.fn()
  },
  user: {
    findMany: jest.fn()
  },
  releaseVote: {
    aggregate: jest.fn(),
    count: jest.fn()
  },
  releaseVoteAggregate: {
    upsert: jest.fn()
  },
  top10Snapshot: {
    findFirst: jest.fn(),
    create: jest.fn()
  },
  $queryRaw: jest.fn()
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock
}));

import {
  createSnapshot,
  getHistorySnapshot,
  getTopReleases,
  getTopTags,
  getTopUsers,
  getTopVotedReleases,
  recomputeVoteAggregate
} from './top10';

describe('getTopReleases', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps contributed release rows and attaches tags', async () => {
    prismaMock.tag.findMany.mockResolvedValue([{ id: 5 }]);
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: BigInt(1),
        title: 'Blue Train',
        year: 1957,
        artistId: BigInt(2),
        artistName: 'John Coltrane',
        type: 'Music',
        releaseType: 'Album',
        consumerCount: 4,
        totalBytesConsumed: BigInt(0),
        contributionCount: 4
      }
    ]);
    prismaMock.releaseTag.findMany.mockResolvedValue([
      { releaseId: 1, tag: { id: 5, name: 'jazz' } }
    ]);

    const result = await getTopReleases({
      type: 'contributed',
      limit: 10,
      excludeTags: 'ambient',
      format: undefined
    });

    expect(result).toEqual([
      {
        rank: 1,
        releaseId: 1,
        title: 'Blue Train',
        year: 1957,
        artistId: 2,
        artistName: 'John Coltrane',
        type: 'Music',
        releaseType: 'Album',
        tags: [{ id: 5, name: 'jazz' }],
        consumerCount: 4,
        totalBytesConsumed: '0',
        contributionCount: 4
      }
    ]);
    expect(prismaMock.tag.findMany).toHaveBeenCalledWith({
      where: { name: { in: ['ambient'] } },
      select: { id: true }
    });
  });

  it('maps consumed and overall windows without tags', async () => {
    prismaMock.tag.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: BigInt(3),
          title: 'Consumed Release',
          year: 2024,
          artistId: BigInt(7),
          artistName: 'Artist',
          type: 'Music',
          releaseType: 'EP',
          consumerCount: 8,
          totalBytesConsumed: BigInt(1024),
          contributionCount: 2
        }
      ])
      .mockResolvedValueOnce([
        {
          id: BigInt(4),
          title: 'Weekly Release',
          year: 2025,
          artistId: BigInt(8),
          artistName: 'Artist 2',
          type: 'Music',
          releaseType: 'Single',
          consumerCount: 3,
          totalBytesConsumed: BigInt(2048),
          contributionCount: 1
        }
      ]);
    prismaMock.releaseTag.findMany.mockResolvedValue([]);

    const consumed = await getTopReleases({
      type: 'consumed',
      limit: 10,
      excludeTags: undefined,
      format: 'flac'
    });
    const weekly = await getTopReleases({
      type: 'week',
      limit: 10,
      excludeTags: undefined,
      format: undefined
    });

    expect(consumed[0].totalBytesConsumed).toBe('1024');
    expect(weekly[0].releaseId).toBe(4);
  });
});

describe('getTopUsers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps contribution speed rows from raw SQL', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: BigInt(7),
        username: 'speedy',
        avatar: null,
        contributed: BigInt(1000),
        consumed: BigInt(500),
        ratio: 2,
        dateRegistered: new Date('2026-01-01T00:00:00.000Z'),
        rankName: 'User',
        rankLevel: 100,
        numContributions: BigInt(3),
        contributionSpeed: 12.5,
        consumeSpeed: 6.25
      }
    ]);

    const result = await getTopUsers({
      type: 'contributionSpeed',
      limit: 10
    });

    expect(result[0]).toEqual(
      expect.objectContaining({
        userId: 7,
        username: 'speedy',
        contributed: '1000',
        consumed: '500',
        numContributions: 3,
        contributionSpeed: 12.5,
        consumeSpeed: 6.25
      })
    );
  });

  it('maps user list results for count-based leaderboards', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: 8,
        username: 'collector',
        avatar: 'avatar.png',
        contributed: BigInt(5000),
        consumed: BigInt(2000),
        ratio: 2.5,
        dateRegistered: new Date(Date.now() - 1000),
        userRank: { name: 'Power User', level: 200 },
        _count: { contributions: 11 }
      }
    ]);

    const result = await getTopUsers({
      type: 'numContributions',
      limit: 10
    });

    expect(result[0]).toEqual(
      expect.objectContaining({
        userId: 8,
        rankName: 'Power User',
        rankLevel: 200,
        numContributions: 11
      })
    );
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          disabled: false,
          contributed: { gt: 0 }
        }),
        orderBy: { contributions: { _count: 'desc' } }
      })
    );
  });
});

describe('getTopTags', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps voted tag aggregates', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: BigInt(1),
        name: 'jazz',
        occurrences: 22,
        positiveVotes: 8,
        negativeVotes: 1
      }
    ]);

    const result = await getTopTags({ type: 'voted', limit: 10 });

    expect(result).toEqual([
      {
        rank: 1,
        tagId: 1,
        name: 'jazz',
        uses: 22,
        positiveVotes: 8,
        negativeVotes: 1
      }
    ]);
  });

  it('maps usage-based tags from prisma', async () => {
    prismaMock.tag.findMany.mockResolvedValue([
      { id: 2, name: 'rock', occurrences: 15 }
    ]);

    const result = await getTopTags({ type: 'used', limit: 10 });

    expect(result[0]).toEqual({
      rank: 1,
      tagId: 2,
      name: 'rock',
      uses: 15,
      positiveVotes: 0,
      negativeVotes: 0
    });
  });
});

describe('getTopVotedReleases', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps vote aggregate rows with downs and positive percent', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: BigInt(9),
        title: 'Kind of Blue',
        year: 1959,
        artistName: 'Miles Davis',
        ups: 95,
        total: 100,
        score: 0.91
      }
    ]);

    const result = await getTopVotedReleases({
      limit: 25,
      tags: 'jazz',
      year: 1959
    });

    expect(result[0]).toEqual({
      rank: 1,
      releaseId: 9,
      title: 'Kind of Blue',
      year: 1959,
      artistName: 'Miles Davis',
      ups: 95,
      downs: 5,
      total: 100,
      score: 0.91,
      positivePercent: 95
    });
  });
});

describe('recomputeVoteAggregate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('recomputes ups, totals, and binomial score before upserting', async () => {
    prismaMock.releaseVote.count
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(7); // ups
    prismaMock.releaseVoteAggregate.upsert.mockResolvedValue(undefined);

    await recomputeVoteAggregate(5);

    expect(prismaMock.releaseVoteAggregate.upsert).toHaveBeenCalledWith({
      where: { releaseId: 5 },
      create: expect.objectContaining({
        releaseId: 5,
        ups: 7,
        total: 10,
        score: expect.any(Number)
      }),
      update: expect.objectContaining({
        ups: 7,
        total: 10,
        score: expect.any(Number)
      })
    });
  });
});

describe('getHistorySnapshot', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when no snapshot exists', async () => {
    prismaMock.top10Snapshot.findFirst.mockResolvedValue(null);

    await expect(
      getHistorySnapshot({ type: 'Daily', date: '2026-05-18' })
    ).resolves.toBeNull();
  });

  it('maps snapshot entries and marks missing releases as deleted', async () => {
    prismaMock.top10Snapshot.findFirst.mockResolvedValue({
      id: 3,
      type: 'Weekly',
      createdAt: new Date('2026-05-18T12:00:00.000Z'),
      entries: [
        {
          rank: 1,
          releaseId: 9,
          releaseTitle: 'Kind of Blue',
          tagString: 'jazz',
          release: null
        },
        {
          rank: 2,
          releaseId: null,
          releaseTitle: 'Deleted entry',
          tagString: '',
          release: null
        }
      ]
    });

    const result = await getHistorySnapshot({ type: 'Weekly' });

    expect(result).toEqual({
      snapshotId: 3,
      type: 'Weekly',
      date: '2026-05-18T12:00:00.000Z',
      entries: [
        {
          rank: 1,
          releaseId: 9,
          releaseTitle: 'Kind of Blue',
          tagString: 'jazz',
          deleted: true
        },
        {
          rank: 2,
          releaseId: null,
          releaseTitle: 'Deleted entry',
          tagString: '',
          deleted: false
        }
      ]
    });
  });
});

describe('createSnapshot', () => {
  beforeEach(() => jest.clearAllMocks());

  it('persists a ranked snapshot using the current top releases', async () => {
    prismaMock.tag.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: BigInt(9),
        title: 'Kind of Blue',
        year: 1959,
        artistId: BigInt(4),
        artistName: 'Miles Davis',
        type: 'Music',
        releaseType: 'Album',
        consumerCount: 10,
        totalBytesConsumed: BigInt(2048),
        contributionCount: 5
      }
    ]);
    prismaMock.releaseTag.findMany.mockResolvedValue([
      { releaseId: 9, tag: { id: 1, name: 'jazz' } }
    ]);
    prismaMock.top10Snapshot.create.mockResolvedValue(undefined);

    await createSnapshot('Daily');

    expect(prismaMock.top10Snapshot.create).toHaveBeenCalledWith({
      data: {
        type: 'Daily',
        entries: {
          create: [
            {
              rank: 1,
              releaseId: 9,
              releaseTitle: 'Miles Davis – Kind of Blue [1959]',
              tagString: 'jazz'
            }
          ]
        }
      }
    });
  });
});
