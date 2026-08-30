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

  it('treats 0 as unlimited wherever it appears in the set', () => {
    // The Math.max inversion: an unlimited primary rank plus a donor secondary
    // of 5 used to resolve to 5 — a perk that *lowered* a ceiling.
    expect(resolveRankQuota([0, 5])).toBeNull();
    expect(resolveRankQuota([5, 0])).toBeNull();
    expect(resolveRankQuota([0])).toBeNull();
    expect(resolveRankQuota([0, 0])).toBeNull();
  });

  it('is unlimited for an empty rank set', () => {
    // Preserves the replaced call sites' behaviour: both read
    // `if (rank && rank.limit > 0)`, so a missing rank row enforced nothing.
    expect(resolveRankQuota([])).toBeNull();
  });

  it('folds a stray negative into unlimited rather than refusing every write', () => {
    // The columns are Int with no check constraint; reading -1 as a cap would
    // make `count >= -1` true forever.
    expect(resolveRankQuota([-1])).toBeNull();
    expect(resolveRankQuota([-1, 5])).toBeNull();
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
        userRank: { personalCollageLimit: 0, authorStylesheetLimit: 2 },
        secondaryRanks: [
          { userRank: { personalCollageLimit: 4, authorStylesheetLimit: 6 } }
        ]
      })
    );
    // Unlimited collages, capped stylesheets — one 0 must not leak sideways.
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
