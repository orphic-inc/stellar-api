/**
 * Unit tests for the profile percentile tiles: the raw contributing value
 * behind each dimension, the artistsAdded and bountySpent dimensions, and the
 * weighted Overall composite (#280).
 *
 * #723: a dimension the member's privacy flags hide is null outright — and not
 * queried at all — and Overall is null unless contributed, consumed and ratio
 * are all visible, since it would give the capped ratio back.
 */

const prismaMock = {
  $queryRaw: jest.fn()
};

jest.mock('../lib/prisma', () => ({
  prisma: prismaMock
}));

// Avoid pulling isomorphic-dompurify (jsdom ESM) through profile.ts → sanitize
// and → bbcode/sanitizeConfig.
jest.mock('../lib/sanitize', () => ({
  sanitizeHtml: (v: string) => v,
  sanitizePlain: (v: string) => v
}));
jest.mock('../lib/bbcode/sanitizeConfig', () => ({
  sanitizeBBCode: (v: string) => v
}));

import { buildOverallPercentile, getPercentileSummary } from './profile';

const activitySummary = {
  contributions: 12,
  requestsCreated: 3,
  requestsFilled: 4,
  forumTopics: 2,
  forumPosts: 30,
  comments: 7,
  collagesStarted: 1,
  collageEntries: 5
};

const user = {
  id: 42,
  contributed: BigInt(3000),
  consumed: BigInt(1000)
};

type Query =
  | 'total'
  | 'contributedAbove'
  | 'consumedAbove'
  | 'contributionsAbove'
  | 'forumPostsAbove'
  | 'requestsFilledAbove'
  | 'artistsAdded'
  | 'artistsAddedAbove'
  | 'bountySpent'
  | 'bountySpentAbove';

/**
 * Which query a `$queryRaw` call is. Hidden dimensions skip their queries, so
 * the call order is not fixed; route on the SQL instead.
 */
const classify = (sql: string): Query => {
  if (sql.includes('metric_sum')) return 'bountySpentAbove';
  if (sql.includes('"request_bounties"')) return 'bountySpent';
  if (sql.includes('"contributed" >')) return 'contributedAbove';
  if (sql.includes('"consumed" >')) return 'consumedAbove';
  if (sql.includes('"contributions" c')) return 'contributionsAbove';
  if (sql.includes('"forum_posts"')) return 'forumPostsAbove';
  if (sql.includes('"request_fills"')) return 'requestsFilledAbove';
  if (sql.includes('metric_count > (')) return 'artistsAddedAbove';
  if (sql.includes('"release_artists"')) return 'artistsAdded';
  return 'total';
};

/** Answers each query with its count (default 0) and records which ran. */
const mockDb = (counts: Partial<Record<Query, number>>) => {
  const issued: Query[] = [];
  prismaMock.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const query = classify(strings.join('?'));
    issued.push(query);
    return Promise.resolve([{ count: BigInt(counts[query] ?? 0) }]);
  });
  return issued;
};

// 101 users, and this member sits above everyone on every dimension → 100th
// percentile across the board, which makes the Overall math easy to read.
const TOP_OF_EVERY_DIMENSION = {
  total: 101,
  artistsAdded: 9,
  bountySpent: 500
};

const ALL_VISIBLE = {
  canSeeContributed: true,
  canSeeConsumed: true,
  canSeeRatio: true
};

describe('getPercentileSummary', () => {
  it('returns every dimension with its raw value when all are visible', async () => {
    mockDb(TOP_OF_EVERY_DIMENSION);

    const summary = await getPercentileSummary(
      user,
      activitySummary,
      ALL_VISIBLE
    );

    expect(summary.contributed).toEqual({
      percentile: 100,
      rank: 1,
      total: 101,
      raw: 3000
    });
    expect(summary.consumed?.raw).toBe(1000);
    expect(summary.contributions.raw).toBe(12);
    expect(summary.forumPosts.raw).toBe(30);
    expect(summary.requestsFilled.raw).toBe(4);
    expect(summary.bountySpent?.raw).toBe(500);
    expect(summary.artistsAdded.raw).toBe(9);
    // Top of every dimension, ratio 3.0 capped to 1 → the weighted mean of 100s.
    expect(summary.overall).toBe(100);
  });

  it('nulls a hidden contributed block, never queries it, and nulls Overall', async () => {
    const issued = mockDb(TOP_OF_EVERY_DIMENSION);

    const summary = await getPercentileSummary(user, activitySummary, {
      ...ALL_VISIBLE,
      canSeeContributed: false
    });

    expect(summary.contributed).toBeNull();
    expect(issued).not.toContain('contributedAbove');
    expect(summary.overall).toBeNull();
    expect(summary.consumed?.raw).toBe(1000);
    expect(summary.bountySpent?.raw).toBe(500);
  });

  it('nulls consumed and bountySpent together when consumed is hidden', async () => {
    const issued = mockDb(TOP_OF_EVERY_DIMENSION);

    const summary = await getPercentileSummary(user, activitySummary, {
      ...ALL_VISIBLE,
      canSeeConsumed: false
    });

    // Bounty is charged to consumed, so its total would floor the hidden stat.
    expect(summary.consumed).toBeNull();
    expect(summary.bountySpent).toBeNull();
    expect(issued).not.toContain('consumedAbove');
    expect(issued).not.toContain('bountySpent');
    expect(issued).not.toContain('bountySpentAbove');
    expect(summary.overall).toBeNull();
    expect(summary.contributed?.raw).toBe(3000);
  });

  it('nulls Overall alone when only ratio is hidden', async () => {
    mockDb(TOP_OF_EVERY_DIMENSION);

    const summary = await getPercentileSummary(user, activitySummary, {
      ...ALL_VISIBLE,
      canSeeRatio: false
    });

    expect(summary.overall).toBeNull();
    expect(summary.contributed).not.toBeNull();
    expect(summary.consumed).not.toBeNull();
    expect(summary.bountySpent).not.toBeNull();
  });

  it('keeps the ungated dimensions whatever the flags', async () => {
    mockDb(TOP_OF_EVERY_DIMENSION);

    const summary = await getPercentileSummary(user, activitySummary, {
      canSeeContributed: false,
      canSeeConsumed: false,
      canSeeRatio: false
    });

    expect(summary.contributions.raw).toBe(12);
    expect(summary.forumPosts.raw).toBe(30);
    expect(summary.requestsFilled.raw).toBe(4);
    expect(summary.artistsAdded.raw).toBe(9);
  });

  it('ranks artistsAdded by the credits the member attached (#722)', async () => {
    // 4 members attached more credits than this one, out of 101.
    mockDb({ ...TOP_OF_EVERY_DIMENSION, artistsAddedAbove: 4 });

    const summary = await getPercentileSummary(
      user,
      activitySummary,
      ALL_VISIBLE
    );

    expect(summary.artistsAdded).toEqual({
      percentile: 96, // (101 − 5) / 100
      rank: 5,
      total: 101,
      raw: 9
    });
  });

  it('ranks bountySpent by the bytes staked', async () => {
    mockDb({ ...TOP_OF_EVERY_DIMENSION, bountySpentAbove: 10 });

    const summary = await getPercentileSummary(
      user,
      activitySummary,
      ALL_VISIBLE
    );

    expect(summary.bountySpent).toEqual({
      percentile: 90, // (101 − 11) / 100
      rank: 11,
      total: 101,
      raw: 500
    });
  });

  it('scales Overall by ratio below 1', async () => {
    mockDb(TOP_OF_EVERY_DIMENSION);

    const summary = await getPercentileSummary(
      { ...user, contributed: BigInt(1000), consumed: BigInt(2000) },
      activitySummary,
      ALL_VISIBLE
    );

    expect(summary.overall).toBe(50);
  });
});

describe('buildOverallPercentile', () => {
  const dimensions = (percentiles: Record<string, number>) => ({
    contributed: { percentile: percentiles.contributed },
    consumed: { percentile: percentiles.consumed },
    contributions: { percentile: percentiles.contributions },
    requestsFilled: { percentile: percentiles.requestsFilled },
    forumPosts: { percentile: percentiles.forumPosts },
    bountySpent: { percentile: percentiles.bountySpent },
    artistsAdded: { percentile: percentiles.artistsAdded }
  });

  const TOP = dimensions({
    contributed: 100,
    consumed: 100,
    contributions: 100,
    requestsFilled: 100,
    forumPosts: 100,
    bountySpent: 100,
    artistsAdded: 100
  });

  it('weights the dimensions (contributions 25 > contributed 15 > consumed 8 > tail)', () => {
    // Weights sum to 53. 90×15 + 50×8 + 80×25 + 40×2 + 20×1 + 30×1 + 10×1 = 3890.
    // 3890 / 53 = 73.4 → 73 at ratio 1.
    expect(
      buildOverallPercentile(
        dimensions({
          contributed: 90,
          consumed: 50,
          contributions: 80,
          requestsFilled: 40,
          forumPosts: 20,
          bountySpent: 30,
          artistsAdded: 10
        }),
        1
      )
    ).toBe(73);
  });

  it('caps ratio at 1 so a strong contributor gains nothing extra', () => {
    expect(buildOverallPercentile(TOP, 1)).toBe(100);
    expect(buildOverallPercentile(TOP, 5)).toBe(100);
  });

  it('drags the composite down when ratio is below 1', () => {
    expect(buildOverallPercentile(TOP, 0.5)).toBe(50);
    expect(buildOverallPercentile(TOP, 0.25)).toBe(25);
  });
});
