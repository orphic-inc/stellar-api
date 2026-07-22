/**
 * Unit tests for the profile percentile tiles (#280): the raw contributing
 * value behind each dimension, the artistsAdded dimension, and the weighted
 * Overall composite.
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

/**
 * getPercentileSummary issues its raw queries in one Promise.all, in this fixed
 * order: total users, then the above-me counts for contributed / consumed /
 * contributions / forumPosts / requestsFilled, then my artist count, then the
 * above-me count for artistsAdded.
 */
const mockCounts = (counts: number[]) => {
  prismaMock.$queryRaw.mockReset();
  for (const count of counts) {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ count: BigInt(count) }]);
  }
};

// 101 users, and this member sits above everyone on every dimension → 100th
// percentile across the board, which makes the Overall math easy to read.
const TOP_OF_EVERY_DIMENSION = [101, 0, 0, 0, 0, 0, 9, 0];

describe('getPercentileSummary', () => {
  it('returns the raw contributing value alongside each percentile', async () => {
    mockCounts(TOP_OF_EVERY_DIMENSION);

    const summary = await getPercentileSummary(user, activitySummary, {
      canSeeContributed: true,
      canSeeConsumed: true
    });

    expect(summary.contributed).toEqual({
      percentile: 100,
      rank: 1,
      total: 101,
      raw: 3000
    });
    expect(summary.consumed.raw).toBe(1000);
    expect(summary.contributions.raw).toBe(12);
    expect(summary.forumPosts.raw).toBe(30);
    expect(summary.requestsFilled.raw).toBe(4);
    expect(summary.artistsAdded.raw).toBe(9);
  });

  it('omits the raw value of a paranoia-gated dimension, keeping its percentile', async () => {
    mockCounts(TOP_OF_EVERY_DIMENSION);

    const summary = await getPercentileSummary(user, activitySummary, {
      canSeeContributed: false,
      canSeeConsumed: false
    });

    expect(summary.contributed.raw).toBeNull();
    expect(summary.consumed.raw).toBeNull();
    expect(summary.contributed.percentile).toBe(100);
    expect(summary.consumed.percentile).toBe(100);
    // Ungated dimensions keep their raw values.
    expect(summary.contributions.raw).toBe(12);
    expect(summary.artistsAdded.raw).toBe(9);
  });

  it('ranks artistsAdded off the earliest artist-history author', async () => {
    // 4 members added more artists than this one, out of 101.
    mockCounts([101, 0, 0, 0, 0, 0, 9, 4]);

    const summary = await getPercentileSummary(user, activitySummary, {
      canSeeContributed: true,
      canSeeConsumed: true
    });

    expect(summary.artistsAdded).toEqual({
      percentile: 96, // (101 − 5) / 100
      rank: 5,
      total: 101,
      raw: 9
    });
  });

  it('scales the Overall composite by ratio (contributed 3000 / consumed 1000 → capped at 1)', async () => {
    mockCounts(TOP_OF_EVERY_DIMENSION);

    const summary = await getPercentileSummary(user, activitySummary, {
      canSeeContributed: true,
      canSeeConsumed: true
    });

    // Top of every dimension, ratio 3.0 capped to 1 → the weighted mean of 100s.
    expect(summary.overall).toBe(100);
  });
});

describe('buildOverallPercentile', () => {
  const dimensions = (percentiles: Record<string, number>) => ({
    contributed: { percentile: percentiles.contributed },
    consumed: { percentile: percentiles.consumed },
    contributions: { percentile: percentiles.contributions },
    requestsFilled: { percentile: percentiles.requestsFilled },
    forumPosts: { percentile: percentiles.forumPosts },
    artistsAdded: { percentile: percentiles.artistsAdded }
  });

  it('weights the dimensions (contributions 25 > contributed 15 > consumed 8 > tail)', () => {
    // Weights sum to 52. 90×15 + 50×8 + 80×25 + 40×2 + 20×1 + 10×1 = 3860.
    // 3860 / 52 = 74.2 → 74 at ratio 1.
    expect(
      buildOverallPercentile(
        dimensions({
          contributed: 90,
          consumed: 50,
          contributions: 80,
          requestsFilled: 40,
          forumPosts: 20,
          artistsAdded: 10
        }),
        1
      )
    ).toBe(74);
  });

  it('caps ratio at 1 so a strong contributor gains nothing extra', () => {
    const top = dimensions({
      contributed: 100,
      consumed: 100,
      contributions: 100,
      requestsFilled: 100,
      forumPosts: 100,
      artistsAdded: 100
    });

    expect(buildOverallPercentile(top, 1)).toBe(100);
    expect(buildOverallPercentile(top, 5)).toBe(100);
  });

  it('drags the composite down when ratio is below 1', () => {
    const top = dimensions({
      contributed: 100,
      consumed: 100,
      contributions: 100,
      requestsFilled: 100,
      forumPosts: 100,
      artistsAdded: 100
    });

    expect(buildOverallPercentile(top, 0.5)).toBe(50);
    expect(buildOverallPercentile(top, 0.25)).toBe(25);
  });
});
