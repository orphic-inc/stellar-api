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

/**
 * The session carries ratio policy (#659) so stellar-ui's site-wide banner can
 * render on every page without a request of its own. What matters here is the
 * projection: the wire name, the null case, and that nothing leaks.
 */
describe('toAuthUser — ratio policy on the session', () => {
  const withPolicy = (policy: unknown) =>
    ({
      ...(rawUser({ personalCollageLimit: 0, authorStylesheetLimit: 0 }) as
        object | Record<string, unknown>),
      ratioPolicyState: policy
    }) as unknown as Parameters<typeof toAuthUser>[0];

  const WATCH = {
    status: 'WATCH',
    watchExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
    disabledCause: null
  };

  it('projects the relation as `ratioPolicy`', () => {
    expect(toAuthUser(withPolicy(WATCH)).ratioPolicy).toEqual(WATCH);
  });

  it('does not also ship the relation under its table name', () => {
    // `toAuthUser` spreads `raw`; without destructuring the relation out, both
    // spellings would go over the wire and drift the first time one changes.
    expect(toAuthUser(withPolicy(WATCH))).not.toHaveProperty(
      'ratioPolicyState'
    );
  });

  it('is null for a member with no policy row', () => {
    // getPolicyState reads a missing row as OK; the session says so by omission
    // rather than by synthesising a status the database never wrote.
    expect(toAuthUser(withPolicy(null)).ratioPolicy).toBeNull();
  });

  it('is null, never undefined, so the key is always on the wire', () => {
    // An undefined would drop the field from the JSON, making "no row"
    // indistinguishable from an api too old to send it.
    const user = toAuthUser(withPolicy(undefined));
    expect(user.ratioPolicy).toBeNull();
    expect(user).toHaveProperty('ratioPolicy');
  });

  it('carries the cause for a disabled member', () => {
    const disabled = {
      status: 'DOWNLOAD_DISABLED',
      watchExpiresAt: null,
      disabledCause: 'STAFF'
    };
    expect(toAuthUser(withPolicy(disabled)).ratioPolicy).toEqual(disabled);
  });
});
