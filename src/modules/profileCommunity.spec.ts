/**
 * Unit tests for the PRD-01 Profile Integration community-stats block —
 * the pure shaping + paranoia gating in `buildCommunityStats`.
 */

// Avoid pulling isomorphic-dompurify (jsdom ESM) through profile.ts → sanitize
// and → bbcode/sanitizeConfig.
jest.mock('../lib/sanitize', () => ({
  sanitizeHtml: (v: string) => v,
  sanitizePlain: (v: string) => v
}));
jest.mock('../lib/bbcode/sanitizeConfig', () => ({
  sanitizeBBCode: (v: string) => v
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
  ],
  suspect: false
};

// A member sitting under a banned trunk: a contagion drag + suspect flag.
const reputationWithContagion = {
  score: 11, // 6 + 4 + 2 − 1
  dimensions: [
    { name: 'longevity', subScore: 6, weighted: 6 },
    { name: 'ratio', subScore: 4, weighted: 4 },
    { name: 'friends', subScore: 2, weighted: 2 },
    { name: 'inviteContagion', subScore: -1, weighted: -1 }
  ],
  suspect: true
};

describe('buildCommunityStats', () => {
  it('returns null when any input is null (top paranoia tier hides all stats)', () => {
    expect(
      buildCommunityStats(null, inviteView, reputation, true, true)
    ).toBeNull();
    expect(buildCommunityStats(5, null, reputation, true, true)).toBeNull();
    expect(buildCommunityStats(5, inviteView, null, true, true)).toBeNull();
  });

  it('maps friends + invite summary (direct/total/depth)', () => {
    const block = buildCommunityStats(5, inviteView, reputation, true, true)!;
    expect(block.friends).toBe(5);
    expect(block.invites).toEqual({ direct: 3, total: 9, depth: 2 });
  });

  it('keeps the full reputation (incl. ratio) when snatch stats are visible', () => {
    const block = buildCommunityStats(5, inviteView, reputation, true, true)!;
    expect(block.reputation.dimensions.map((d) => d.name)).toContain('ratio');
    expect(block.reputation.score).toBe(12);
  });

  it('drops the snatch-derived ratio dimension and recomputes when hidden', () => {
    const block = buildCommunityStats(5, inviteView, reputation, false, true)!;
    expect(block.reputation.dimensions.map((d) => d.name)).not.toContain(
      'ratio'
    );
    // 6 (longevity) + 2 (friends) = 8
    expect(block.reputation.score).toBe(8);
  });

  it('shows the contagion drag + suspect flag to staff (includeModeration)', () => {
    const block = buildCommunityStats(
      5,
      inviteView,
      reputationWithContagion,
      true,
      true
    )!;
    expect(block.reputation.dimensions.map((d) => d.name)).toContain(
      'inviteContagion'
    );
    expect(block.reputation.suspect).toBe(true);
    expect(block.reputation.score).toBe(11);
  });

  it('hides the contagion drag + suspect from non-staff (recomputes score)', () => {
    const block = buildCommunityStats(
      5,
      inviteView,
      reputationWithContagion,
      true,
      false
    )!;
    expect(block.reputation.dimensions.map((d) => d.name)).not.toContain(
      'inviteContagion'
    );
    expect(block.reputation.suspect).toBe(false);
    // Penalty stripped from the displayed total: 6 + 4 + 2 = 12.
    expect(block.reputation.score).toBe(12);
  });
});
