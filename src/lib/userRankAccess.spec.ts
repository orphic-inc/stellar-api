/**
 * The rank-quota resolver (#369, ADR-0032 §4).
 *
 * The bug this pins is an agreement bug, not an arithmetic one: `toAuthUser`
 * advertised the maximum across primary + secondary ranks while the two
 * enforcement sites read the primary rank alone, so a donor was shown 5, allowed
 * 3, and refused with a number they had never been told. Both sides now resolve
 * through `resolveRankQuota`, so these cases are the contract for both.
 */
import { resolveRankQuota, getUserRankQuotas } from './userRankAccess';

describe('resolveRankQuota', () => {
  it('takes the highest cap in the rank set, so a secondary rank can only raise it', () => {
    // PRD-03's donor-added slots: the perk is modelled as a secondary rank.
    expect(resolveRankQuota([3, 5])).toBe(5);
    expect(resolveRankQuota([5, 3])).toBe(5);
    expect(resolveRankQuota([2])).toBe(2);
  });

  it('treats null as unlimited wherever it appears in the set', () => {
    // The Math.max inversion: an unlimited primary rank plus a donor secondary
    // of 5 used to resolve to 5 — a perk that *lowered* a ceiling (#369).
    expect(resolveRankQuota([null, 5])).toBeNull();
    expect(resolveRankQuota([5, null])).toBeNull();
    expect(resolveRankQuota([null])).toBeNull();
    expect(resolveRankQuota([0, null])).toBeNull();
  });

  // #881: 0 is none, so it is a cap like any other and a higher one beats it.
  it('reads 0 as none, which any higher cap in the set raises', () => {
    expect(resolveRankQuota([0])).toBe(0);
    expect(resolveRankQuota([0, 0])).toBe(0);
    expect(resolveRankQuota([0, 3])).toBe(3);
    expect(resolveRankQuota([3, 0])).toBe(3);
  });

  it('is unlimited for an empty rank set', () => {
    // Preserves the replaced call sites' behaviour: both read
    // `if (rank && rank.limit > 0)`, so a missing rank row enforced nothing.
    expect(resolveRankQuota([])).toBeNull();
  });
});

describe('getUserRankQuotas', () => {
  const clientFor = (row: unknown) =>
    ({
      user: { findUnique: jest.fn().mockResolvedValue(row) }
    }) as unknown as Parameters<typeof getUserRankQuotas>[1];

  it('resolves both limits across primary and secondary ranks', async () => {
    const quotas = await getUserRankQuotas(
      1,
      clientFor({
        userRank: { personalCollageLimit: 3, authorStylesheetLimit: 3 },
        secondaryRanks: [
          { userRank: { personalCollageLimit: 5, authorStylesheetLimit: 5 } }
        ]
      })
    );
    // The donor case, in the shape the enforcement sites consume.
    expect(quotas).toEqual({
      personalCollageLimit: 5,
      authorStylesheetLimit: 5
    });
  });

  it('resolves each limit independently of the other', async () => {
    const quotas = await getUserRankQuotas(
      1,
      clientFor({
        userRank: { personalCollageLimit: null, authorStylesheetLimit: 2 },
        secondaryRanks: [
          { userRank: { personalCollageLimit: 4, authorStylesheetLimit: 6 } }
        ]
      })
    );
    // Unlimited collages, capped stylesheets — one null must not leak sideways.
    expect(quotas).toEqual({
      personalCollageLimit: null,
      authorStylesheetLimit: 6
    });
  });

  it('is unlimited when the member has no rank row at all', async () => {
    expect(await getUserRankQuotas(1, clientFor(null))).toEqual({
      personalCollageLimit: null,
      authorStylesheetLimit: null
    });
  });
});
