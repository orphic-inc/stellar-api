/**
 * `toAuthUser`'s quota fields — the *advertised* half of the #369 agreement.
 *
 * The enforcement half lives in `lib/userRankAccess.spec.ts` and the two route
 * specs. What matters is that both halves resolve the same rank set the same
 * way: a member shown 5 and refused at 3 was the bug.
 */
jest.mock('../lib/prisma', () => ({ prisma: {} }));

import { toAuthUser } from './auth';

const rank = (limits: {
  personalCollageLimit: number;
  authorStylesheetLimit: number;
}) => ({
  id: 1,
  level: 100,
  name: 'User',
  color: '',
  badge: '',
  permissions: {},
  permittedForumIds: [],
  ...limits
});

const rawUser = (
  primary: { personalCollageLimit: number; authorStylesheetLimit: number },
  secondaries: {
    personalCollageLimit: number;
    authorStylesheetLimit: number;
  }[] = []
) =>
  ({
    id: 7,
    username: 'kai',
    contributed: BigInt(10),
    consumed: BigInt(5),
    userRank: rank(primary),
    secondaryRanks: secondaries.map((limits, i) => ({
      userRankId: i + 2,
      userRank: rank(limits)
    }))
  }) as unknown as Parameters<typeof toAuthUser>[0];

describe('toAuthUser — advertised rank quotas', () => {
  it('advertises the highest cap across primary and secondary ranks', () => {
    const user = toAuthUser(
      rawUser({ personalCollageLimit: 1, authorStylesheetLimit: 3 }, [
        { personalCollageLimit: 4, authorStylesheetLimit: 5 }
      ])
    );
    expect(user.userRank.personalCollageLimit).toBe(4);
    expect(user.userRank.authorStylesheetLimit).toBe(5);
  });

  it('advertises unlimited as 0 when any rank in the set is unlimited', () => {
    // The wire has always spelled unlimited as 0; the bug was Math.max
    // reporting the donor's 5 and thereby *capping* an unlimited rank.
    const user = toAuthUser(
      rawUser({ personalCollageLimit: 0, authorStylesheetLimit: 0 }, [
        { personalCollageLimit: 4, authorStylesheetLimit: 5 }
      ])
    );
    expect(user.userRank.personalCollageLimit).toBe(0);
    expect(user.userRank.authorStylesheetLimit).toBe(0);
  });

  it('is unaffected by a secondary rank that adds nothing', () => {
    const user = toAuthUser(
      rawUser({ personalCollageLimit: 3, authorStylesheetLimit: 3 }, [
        { personalCollageLimit: 1, authorStylesheetLimit: 1 }
      ])
    );
    expect(user.userRank.personalCollageLimit).toBe(3);
    expect(user.userRank.authorStylesheetLimit).toBe(3);
  });
});
