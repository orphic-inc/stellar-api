/**
 * Unit tests for the shared release tag helpers.
 *
 * `buildReleaseTagPayload` was private to two modules until it was hoisted here,
 * so it had only ever been exercised through the workbench read. Now that it is
 * exported it can be pinned directly — which matters, because the ±1 vote
 * seeding it undoes is a scoring convention rather than an implementation
 * detail, and it is the reason the unvoted and voted cases produce different
 * shapes from the same input row.
 */

import { ReleaseTagVoteDirection } from '@prisma/client';
import { buildPlainTags, buildReleaseTagPayload } from './releaseTags';

const tag = (id: number, name: string, occurrences = 0) => ({
  id,
  name,
  occurrences
});

const releaseTagRow = (
  over: Partial<{
    id: number;
    tagId: number;
    positiveVotes: number;
    negativeVotes: number;
    createdAt: Date;
    user: { id: number; username: string } | null;
    votes: Array<{ direction: ReleaseTagVoteDirection }>;
  }> = {}
) => ({
  id: 100,
  tagId: 1,
  positiveVotes: 3,
  negativeVotes: 1,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  user: { id: 7, username: 'kai' },
  votes: [],
  ...over
});

describe('buildPlainTags', () => {
  it('flattens to the tag and sorts by name', () => {
    expect(
      buildPlainTags([
        { tag: tag(2, 'rock') },
        { tag: tag(1, 'ambient') },
        { tag: tag(3, 'jazz') }
      ]).map((t) => t.name)
    ).toEqual(['ambient', 'jazz', 'rock']);
  });
});

describe('buildReleaseTagPayload', () => {
  it('subtracts the ±1 seed from the displayed counts but not from score', () => {
    const [row] = buildReleaseTagPayload(
      [tag(1, 'rock', 12)],
      [releaseTagRow({ positiveVotes: 5, negativeVotes: 2 })]
    );
    // score keeps the raw difference…
    expect(row.score).toBe(3);
    // …while the displayed counts have the seed removed.
    expect(row.positiveVotes).toBe(4);
    expect(row.negativeVotes).toBe(1);
    expect(row.id).toBe(100);
    expect(row.tagId).toBe(1);
    expect(row.occurrences).toBe(12);
    expect(row.addedBy).toEqual({ id: 7, username: 'kai' });
  });

  it('never reports a negative displayed count', () => {
    const [row] = buildReleaseTagPayload(
      [tag(1, 'rock')],
      [releaseTagRow({ positiveVotes: 0, negativeVotes: 0 })]
    );
    expect(row.positiveVotes).toBe(0);
    expect(row.negativeVotes).toBe(0);
    expect(row.score).toBe(0);
  });

  it('reports a tag with no ReleaseTag row as unvoted, keyed by the tag id', () => {
    const [row] = buildReleaseTagPayload([tag(42, 'ambient', 3)], []);
    expect(row).toEqual({
      id: 42,
      tagId: 42,
      name: 'ambient',
      occurrences: 3,
      score: 0,
      positiveVotes: 0,
      negativeVotes: 0,
      addedBy: null,
      createdAt: null,
      myVotes: { up: false, down: false }
    });
  });

  it("reflects the caller's own votes", () => {
    const [row] = buildReleaseTagPayload(
      [tag(1, 'rock')],
      [
        releaseTagRow({
          votes: [{ direction: ReleaseTagVoteDirection.down }]
        })
      ]
    );
    expect(row.myVotes).toEqual({ up: false, down: true });
  });

  it('sorts by score descending, then by name', () => {
    const rows = buildReleaseTagPayload(
      [tag(1, 'rock'), tag(2, 'ambient'), tag(3, 'jazz')],
      [
        releaseTagRow({ id: 10, tagId: 1, positiveVotes: 2, negativeVotes: 1 }),
        releaseTagRow({ id: 11, tagId: 2, positiveVotes: 9, negativeVotes: 1 }),
        // Same score as 'rock' (1), so 'jazz' sorts ahead of it by name.
        releaseTagRow({ id: 12, tagId: 3, positiveVotes: 2, negativeVotes: 1 })
      ]
    );
    expect(rows.map((r) => r.name)).toEqual(['ambient', 'jazz', 'rock']);
  });
});
