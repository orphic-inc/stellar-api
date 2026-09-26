/**
 * `toAuthUser`'s quota fields — the *advertised* half of the #369 agreement.
 *
 * The enforcement half lives in `lib/userRankAccess.spec.ts` and the two route
 * specs. What matters is that both halves resolve the same rank set the same
 * way: a member shown 5 and refused at 3 was the bug.
 */
jest.mock('../lib/prisma', () => ({ prisma: {} }));

import { authUserSelect, toAuthUser } from './auth';

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
    })),
    warnings: []
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

describe('toAuthUser — the notification filter allowance (#715)', () => {
  // The primary rank's value, as `getFilterAllowance` enforces it: a member
  // shown one allowance and held to another is the #369 bug again.
  const withLimits = (primary: number | null, secondary?: number | null) => {
    const raw = rawUser(
      { personalCollageLimit: 0, authorStylesheetLimit: 0 },
      secondary === undefined
        ? []
        : [{ personalCollageLimit: 0, authorStylesheetLimit: 0 }]
    ) as unknown as {
      userRank: Record<string, unknown>;
      secondaryRanks: { userRank: Record<string, unknown> }[];
    };
    raw.userRank.notificationFilterLimit = primary;
    if (secondary !== undefined)
      raw.secondaryRanks[0].userRank.notificationFilterLimit = secondary;
    return toAuthUser(raw as unknown as Parameters<typeof toAuthUser>[0]);
  };

  it('is selected for the session', () => {
    expect(authUserSelect.userRank.select.notificationFilterLimit).toBe(true);
  });

  it('carries the primary rank’s cap', () => {
    expect(withLimits(3).userRank.notificationFilterLimit).toBe(3);
  });

  it('keeps unlimited as null, never 0: 0 means the rank has none', () => {
    expect(withLimits(null).userRank.notificationFilterLimit).toBeNull();
  });

  it('is not raised by a secondary rank, which enforcement does not read', () => {
    expect(withLimits(0, 5).userRank.notificationFilterLimit).toBe(0);
  });
});

/**
 * `warnedUntil` (#719): when the member's own warned state ends, for the expiry
 * tooltip on their own name. On the session, not AuthorRef, so no viewer ever
 * receives another member's expiry.
 */
describe('toAuthUser — warnedUntil on the session', () => {
  const HOUR = 3_600_000;
  const at = (offsetMs: number) => new Date(Date.now() + offsetMs);
  const withWarnings = (warnings: { expiresAt: Date | null }[]) =>
    toAuthUser({
      ...(rawUser({ personalCollageLimit: 0, authorStylesheetLimit: 0 }) as
        object | Record<string, unknown>),
      warnings
    } as unknown as Parameters<typeof toAuthUser>[0]);

  it('is selected for the session', () => {
    expect(authUserSelect.warnings).toEqual({ select: { expiresAt: true } });
  });

  it('is the latest expiry among active warnings', () => {
    const later = at(48 * HOUR);
    expect(
      withWarnings([
        { expiresAt: at(HOUR) },
        { expiresAt: later },
        { expiresAt: at(-HOUR) }
      ]).warnedUntil
    ).toBe(later.toISOString());
  });

  it('is null once every warning has expired', () => {
    expect(withWarnings([{ expiresAt: at(-HOUR) }]).warnedUntil).toBeNull();
  });

  it('is null while a permanent warning is active', () => {
    expect(
      withWarnings([{ expiresAt: at(HOUR) }, { expiresAt: null }]).warnedUntil
    ).toBeNull();
  });

  it('does not ship the warning rows themselves', () => {
    expect(withWarnings([{ expiresAt: at(HOUR) }])).not.toHaveProperty(
      'warnings'
    );
  });
});
