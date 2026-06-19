/**
 * Unit tests for the PRD-01 Profile Integration community-stats block —
 * the pure shaping + paranoia gating in `buildCommunityStats`.
 */

// Avoid pulling isomorphic-dompurify (jsdom ESM) through profile.ts → sanitize.
jest.mock('../lib/sanitize', () => ({
  sanitizeHtml: (v: string) => v,
  sanitizePlain: (v: string) => v
}));

import { buildCommunityStats } from './profile';

const inviteView = {
  summary: { branches: 3, entries: 9, depth: 2 }
};

const reputation = {
  score: 12,
  dimensions: [
    { name: 'longevity', subScore: 6, weighted: 6 },
    { name: 'ratio', subScore: 4, weighted: 4 },
    { name: 'friends', subScore: 2, weighted: 2 }
  ]
};

describe('buildCommunityStats', () => {
  it('returns null when any input is null (top paranoia tier hides all stats)', () => {
    expect(buildCommunityStats(null, inviteView, reputation, true)).toBeNull();
    expect(buildCommunityStats(5, null, reputation, true)).toBeNull();
    expect(buildCommunityStats(5, inviteView, null, true)).toBeNull();
  });

  it('maps friends + invite summary (direct/total/depth)', () => {
    const block = buildCommunityStats(5, inviteView, reputation, true)!;
    expect(block.friends).toBe(5);
    expect(block.invites).toEqual({ direct: 3, total: 9, depth: 2 });
  });

  it('keeps the full reputation (incl. ratio) when snatch stats are visible', () => {
    const block = buildCommunityStats(5, inviteView, reputation, true)!;
    expect(block.reputation.dimensions.map((d) => d.name)).toContain('ratio');
    expect(block.reputation.score).toBe(12);
  });

  it('drops the snatch-derived ratio dimension and recomputes when hidden', () => {
    const block = buildCommunityStats(5, inviteView, reputation, false)!;
    expect(block.reputation.dimensions.map((d) => d.name)).not.toContain(
      'ratio'
    );
    // 6 (longevity) + 2 (friends) = 8
    expect(block.reputation.score).toBe(8);
  });
});
