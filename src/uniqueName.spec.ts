/**
 * Unit tests for `uniqueName` (src/test/dbHelpers.ts).
 *
 * The bug this guards against is a race, and a race cannot be asserted by
 * running the code and hoping. So the clock is FROZEN: with `Date.now()` pinned
 * to a constant, the pre-fix scheme (`${prefix}-${Date.now()}`) collides on
 * every single call rather than on the unlucky ones, and this test fails
 * deterministically instead of flaking in the same way the bug did.
 */

// dbHelpers constructs a PrismaClient at import time against
// STELLAR_PSQL_URI_TEST, which is not set for the unit suite. The constructor
// is all that runs — no connection is opened until a query — but it is stubbed
// anyway so this spec depends on nothing but the helper.
jest.mock('@prisma/client', () => ({
  PrismaClient: class {
    $executeRawUnsafe = jest.fn();
    $disconnect = jest.fn();
  }
}));

import { uniqueName } from './test/dbHelpers';

describe('uniqueName', () => {
  it('returns distinct names when the clock does not move', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_767_225_600_000);
    try {
      const a = uniqueName('Community');
      const b = uniqueName('Community');
      const c = uniqueName('Community');

      // The whole point: same millisecond, three different names.
      expect(new Set([a, b, c]).size).toBe(3);
      expect(now).toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('keeps the prefix readable at the front of the name', () => {
    expect(uniqueName('Community')).toMatch(/^Community-\d+-\d+$/);
  });

  it('does not reuse a counter value across prefixes', () => {
    const first = uniqueName('A');
    const second = uniqueName('B');
    const seqOf = (n: string) => Number(n.split('-')[1]);

    expect(seqOf(second)).toBeGreaterThan(seqOf(first));
  });
});
