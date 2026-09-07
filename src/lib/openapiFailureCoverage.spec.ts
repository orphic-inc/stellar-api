/**
 * The failure-coverage gate (#517).
 *
 * The cases that carry this file are the two baseline lists behaving as
 * DIFFERENT things — `unreviewed` shrinking, `noFailureModes` durable — and the
 * gate-subtraction that makes a handler-thrown 403 this axis's business while
 * leaving a middleware-thrown one to #494. The last describe block pins the
 * blind spot deliberately, so nobody later mistakes it for a bug.
 */
import {
  checkFailureCoverage,
  formatFailureCoverageReport,
  gateIndependentCodes,
  type FailureBaseline
} from './openapiFailureCoverage';
import type { Operation } from './openapiCompleteness';
import type { GateKind } from './routeGate';

const op = (
  method: string,
  path: string,
  gates: GateKind[] = []
): Operation => ({
  method,
  path,
  gates: gates.map((kind) => ({ kind }))
});

const decl = (entries: [string, string[]][]): Map<string, Set<string>> =>
  new Map(entries.map(([k, v]) => [k, new Set(v)]));

const EMPTY: FailureBaseline = { unreviewed: [], noFailureModes: [] };

describe('gateIndependentCodes', () => {
  it('subtracts the 401 a requireAuth route already accounts for', () => {
    const codes = gateIndependentCodes(
      op('GET', '/x', ['auth']),
      new Set(['200', '401', '404'])
    );
    expect(codes).toEqual(['404']);
  });

  it("subtracts both codes a permission route's middleware implies", () => {
    // requirePermission spreads [requireAuth, check], so 401 AND 403 are its
    // middleware's, not its handler's.
    const codes = gateIndependentCodes(
      op('POST', '/x', ['permission']),
      new Set(['201', '401', '403', '409'])
    );
    expect(codes).toEqual(['409']);
  });

  it('keeps a 403 the gates cannot explain — the /auth/register shape', () => {
    // No gate, so a 403 can only have come from the handler. #494 is blind to
    // it by construction; that is precisely why it belongs to this axis.
    const codes = gateIndependentCodes(
      op('POST', '/auth/register', []),
      new Set(['200', '400', '403'])
    );
    expect(codes).toEqual(['400', '403']);
  });

  it('keeps a 403 on an auth-only route, which implies 401 alone', () => {
    // The five real operations that separate this measure from a naive
    // "4xx other than 401/403" count.
    const codes = gateIndependentCodes(
      op('GET', '/reports/{id}', ['auth']),
      new Set(['200', '401', '403'])
    );
    expect(codes).toEqual(['403']);
  });

  it('ignores 2xx and 5xx entirely', () => {
    const codes = gateIndependentCodes(
      op('GET', '/x', []),
      new Set(['200', '204', '500', '502'])
    );
    expect(codes).toEqual([]);
  });
});

describe('checkFailureCoverage', () => {
  it('fails an operation that declares nothing and is in neither list', () => {
    const result = checkFailureCoverage({
      routes: [op('GET', '/widgets/{id}', ['auth'])],
      declared: decl([['GET /widgets/{id}', ['200', '401']]]),
      baseline: EMPTY
    });
    expect(result.ok).toBe(false);
    expect(result.unclassified).toEqual(['GET /widgets/{id}']);
  });

  it('passes it once it is grandfathered as unreviewed', () => {
    const result = checkFailureCoverage({
      routes: [op('GET', '/widgets/{id}', ['auth'])],
      declared: decl([['GET /widgets/{id}', ['200', '401']]]),
      baseline: { unreviewed: ['GET /widgets/{id}'], noFailureModes: [] }
    });
    expect(result.ok).toBe(true);
  });

  it('passes it once a human records it as answering nothing', () => {
    const result = checkFailureCoverage({
      routes: [op('GET', '/bookmarks', ['auth'])],
      declared: decl([['GET /bookmarks', ['200', '401']]]),
      baseline: { unreviewed: [], noFailureModes: ['GET /bookmarks'] }
    });
    expect(result.ok).toBe(true);
    expect(result.totals.silent).toBe(1);
  });

  it('passes once the code is actually declared, with no baseline at all', () => {
    const result = checkFailureCoverage({
      routes: [op('GET', '/widgets/{id}', ['auth'])],
      declared: decl([['GET /widgets/{id}', ['200', '401', '404']]]),
      baseline: EMPTY
    });
    expect(result.ok).toBe(true);
    expect(result.totals.documented).toBe(1);
  });

  it('never reports an unregistered route — that is the completeness gate', () => {
    // Declaring nothing at all is #474's finding. Reporting it here too would
    // double-count one problem across two gates.
    const result = checkFailureCoverage({
      routes: [op('GET', '/unregistered', ['auth'])],
      declared: decl([]),
      baseline: EMPTY
    });
    expect(result.ok).toBe(true);
    expect(result.unclassified).toEqual([]);
  });

  describe('the ratchet', () => {
    it('fails an unreviewed entry that is now documented', () => {
      const result = checkFailureCoverage({
        routes: [op('GET', '/widgets/{id}', ['auth'])],
        declared: decl([['GET /widgets/{id}', ['200', '401', '404']]]),
        baseline: { unreviewed: ['GET /widgets/{id}'], noFailureModes: [] }
      });
      expect(result.ok).toBe(false);
      expect(result.staleUnreviewed).toEqual(['GET /widgets/{id}']);
    });

    it('fails an entry naming a route the app no longer serves', () => {
      const result = checkFailureCoverage({
        routes: [],
        declared: decl([]),
        baseline: {
          unreviewed: ['GET /removed'],
          noFailureModes: ['POST /also-removed']
        }
      });
      expect(result.ok).toBe(false);
      expect(result.staleUnreviewed).toEqual(['GET /removed']);
      expect(result.staleNoFailureModes).toEqual(['POST /also-removed']);
    });

    it('fails a noFailureModes entry the contract now contradicts', () => {
      // Someone recorded "answers nothing" and the registration disagrees. The
      // reading was wrong or the handler changed; either way it needs re-doing,
      // and silently tolerating it would let a bad reading harden into a mute.
      const result = checkFailureCoverage({
        routes: [op('GET', '/bookmarks', ['auth'])],
        declared: decl([['GET /bookmarks', ['200', '401', '404']]]),
        baseline: { unreviewed: [], noFailureModes: ['GET /bookmarks'] }
      });
      expect(result.ok).toBe(false);
      expect(result.staleNoFailureModes).toEqual(['GET /bookmarks']);
    });

    it('separates a documented route from a silent one in the totals', () => {
      const result = checkFailureCoverage({
        routes: [
          op('GET', '/a', ['auth']),
          op('GET', '/b', ['auth']),
          op('GET', '/c', ['auth'])
        ],
        declared: decl([
          ['GET /a', ['200', '401', '404']],
          ['GET /b', ['200', '401']],
          ['GET /c', ['200', '401']]
        ]),
        baseline: { unreviewed: ['GET /c'], noFailureModes: ['GET /b'] }
      });
      expect(result.ok).toBe(true);
      expect(result.totals).toMatchObject({
        routes: 3,
        documented: 1,
        silent: 1,
        unreviewed: 1
      });
    });
  });

  describe('the blind spot, pinned deliberately', () => {
    it('does NOT flag a partially-described operation', () => {
      // POST /auth/register declares 200/400 and answers 403 on three branches
      // (src/routes/api/auth.ts:123-135). It declares SOMETHING, so it counts
      // as covered here and the missing 403 goes unreported.
      //
      // This is the accepted cost of keeping the codes in the registry alone
      // rather than duplicating them into the baseline, where they could drift.
      // The per-surface handler read catches it; this gate does not pretend to.
      // If that trade is ever revisited, this test is the thing to change.
      const result = checkFailureCoverage({
        routes: [op('POST', '/auth/register', [])],
        declared: decl([['POST /auth/register', ['200', '400']]]),
        baseline: EMPTY
      });
      expect(result.ok).toBe(true);
      expect(result.unclassified).toEqual([]);
    });
  });
});

describe('formatFailureCoverageReport', () => {
  it('says "declare at least one", never "documented"', () => {
    // The summary must not claim completeness it cannot measure — the mistake
    // caught on #549, where a ratchet reported inherited surplus as clean.
    const report = formatFailureCoverageReport({
      unclassified: [],
      staleUnreviewed: [],
      staleNoFailureModes: [],
      totals: { routes: 364, documented: 215, silent: 0, unreviewed: 149 },
      ok: true
    });
    expect(report).toContain('215 declare at least one handler failure code');
    expect(report).not.toMatch(/215 documented/);
  });

  it('tells an unclassified operation how to get out of both lists', () => {
    const report = formatFailureCoverageReport({
      unclassified: ['GET /widgets/{id}'],
      staleUnreviewed: [],
      staleNoFailureModes: [],
      totals: { routes: 1, documented: 0, silent: 0, unreviewed: 0 },
      ok: false
    });
    expect(report).toContain('GET /widgets/{id}');
    expect(report).toContain('Read the handler');
    expect(report).toContain('noFailureModes');
  });
});
