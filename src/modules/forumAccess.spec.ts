/**
 * The forum read gate, in both of its shapes (#509).
 *
 * `assertForumReadAccess` answers for one forum; `forumReadableWhere` answers
 * for all of them at once inside a query. They encode the same rule, so the
 * tests that matter here are the ones that would fail if only one of them
 * changed.
 */
const mockPrismaForum = { findUnique: jest.fn() };

jest.mock('../lib/prisma', () => ({
  prisma: { forum: mockPrismaForum }
}));

import { canAccessForumLevel } from '../lib/userRankAccess';
import { assertForumReadAccess, forumReadableWhere } from './forumAccess';
import type { AuthUser } from '../types/auth';

const user = (userRankLevel: number, permittedForumIds: number[] = []) =>
  ({ id: 1, userRankId: 1, userRankLevel, permittedForumIds }) as AuthUser;

describe('forumReadableWhere', () => {
  it('admits a forum by class floor or by explicit permit', () => {
    expect(forumReadableWhere(user(200, [9]))).toEqual({
      OR: [{ minClassRead: { lte: 200 } }, { id: { in: [9] } }]
    });
  });

  it('treats an absent permit list as no permits, not as every forum', () => {
    const bare = { id: 1, userRankId: 1, userRankLevel: 0 } as AuthUser;
    expect(forumReadableWhere(bare)).toEqual({
      OR: [{ minClassRead: { lte: 0 } }, { id: { in: [] } }]
    });
  });

  // The guard that earns this file. A search cannot call the predicate — it has
  // no forum id — so the rule exists twice, and nothing but this test stops the
  // two from drifting apart (ADR-0010).
  it.each([
    { level: 0, permits: [] as number[], forumId: 1, floor: 0 },
    { level: 0, permits: [], forumId: 1, floor: 500 },
    { level: 500, permits: [], forumId: 1, floor: 500 },
    { level: 499, permits: [], forumId: 1, floor: 500 },
    { level: 0, permits: [1], forumId: 1, floor: 500 },
    { level: 0, permits: [2], forumId: 1, floor: 500 },
    { level: 1000, permits: [], forumId: 7, floor: 200 }
  ])(
    'agrees with canAccessForumLevel (level $level, permits $permits, floor $floor)',
    ({ level, permits, forumId, floor }) => {
      const actor = user(level, permits);
      const predicate = canAccessForumLevel(actor, forumId, floor);

      // Evaluate the fragment the way Postgres would, against one forum row.
      const fragment = forumReadableWhere(actor);
      const matches = fragment.OR!.some((arm) => {
        const clause = arm as {
          minClassRead?: { lte: number };
          id?: { in: number[] };
        };
        if (clause.minClassRead) return floor <= clause.minClassRead.lte;
        return clause.id!.in.includes(forumId);
      });

      expect(matches).toBe(predicate);
    }
  );
});

describe('assertForumReadAccess', () => {
  it('throws 404 when the forum does not exist', async () => {
    mockPrismaForum.findUnique.mockResolvedValueOnce(null);
    await expect(assertForumReadAccess(user(1000), 1)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('throws 403 when the caller is below the read floor', async () => {
    mockPrismaForum.findUnique.mockResolvedValueOnce({ minClassRead: 500 });
    await expect(assertForumReadAccess(user(200), 1)).rejects.toMatchObject({
      statusCode: 403
    });
  });

  it('passes a caller admitted by an explicit permit below the floor', async () => {
    mockPrismaForum.findUnique.mockResolvedValueOnce({ minClassRead: 500 });
    await expect(
      assertForumReadAccess(user(0, [1]), 1)
    ).resolves.toBeUndefined();
  });
});
