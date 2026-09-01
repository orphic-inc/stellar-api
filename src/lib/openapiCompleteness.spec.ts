import {
  checkOpenapiCompleteness,
  formatCompletenessReport,
  type Baseline,
  type Operation
} from './openapiCompleteness';

const op = (s: string): Operation => {
  const [method, ...rest] = s.split(' ');
  return { method, path: rest.join(' ') };
};

const noBaseline: Baseline = { unregistered: [], paramMismatches: [] };

const check = (
  routes: string[],
  registered: string[],
  baseline: Baseline = noBaseline
) =>
  checkOpenapiCompleteness({
    routes: routes.map(op),
    registered: registered.map(op),
    baseline
  });

describe('checkOpenapiCompleteness', () => {
  it('passes when every route is registered', () => {
    const r = check(
      ['GET /users', 'POST /users'],
      ['GET /users', 'POST /users']
    );

    expect(r.ok).toBe(true);
    expect(r.newlyUnregistered).toEqual([]);
    expect(r.totals).toEqual({
      routes: 2,
      registered: 2,
      unregistered: 0,
      baselined: 0
    });
  });

  it('fails on a route the registry does not declare', () => {
    const r = check(['GET /users', 'GET /wiki'], ['GET /users']);

    expect(r.ok).toBe(false);
    expect(r.newlyUnregistered).toEqual(['GET /wiki']);
  });

  it('distinguishes methods on the same path', () => {
    const r = check(['GET /users', 'DELETE /users'], ['GET /users']);

    expect(r.newlyUnregistered).toEqual(['DELETE /users']);
  });

  it('does not care that the registry declares MORE than is served', () => {
    // A registered operation with no route is a different defect (a spec that
    // over-promises); this checker is about routes with no registration.
    const r = check(['GET /users'], ['GET /users', 'GET /retired']);

    expect(r.ok).toBe(true);
  });

  describe('param names', () => {
    it('matches a route to its registration despite a different param name', () => {
      const r = check(['GET /users/{id}'], ['GET /users/{userId}']);

      expect(r.newlyUnregistered).toEqual([]);
      expect(r.ok).toBe(true);
    });

    it('reports the mismatch as a warning, not a failure', () => {
      const r = check(['GET /users/{id}'], ['GET /users/{userId}']);

      expect(r.newParamMismatches).toEqual(['GET /users/{id}']);
      expect(r.ok).toBe(true);
    });

    it('stays quiet about a baselined mismatch', () => {
      const r = check(['GET /users/{id}'], ['GET /users/{userId}'], {
        unregistered: [],
        paramMismatches: ['GET /users/{id}']
      });

      expect(r.newParamMismatches).toEqual([]);
    });
  });

  describe('the baseline ratchet', () => {
    it('tolerates a grandfathered gap', () => {
      const r = check(['GET /users', 'GET /wiki'], ['GET /users'], {
        unregistered: ['GET /wiki'],
        paramMismatches: []
      });

      expect(r.ok).toBe(true);
      expect(r.newlyUnregistered).toEqual([]);
      expect(r.totals.baselined).toBe(1);
    });

    it('still fails on a NEW gap alongside a grandfathered one', () => {
      const r = check(
        ['GET /users', 'GET /wiki', 'POST /collages'],
        ['GET /users'],
        { unregistered: ['GET /wiki'], paramMismatches: [] }
      );

      expect(r.ok).toBe(false);
      expect(r.newlyUnregistered).toEqual(['POST /collages']);
    });

    // Rule 2: the list must shrink as the backlog burns down.
    it('fails when a baselined route has since been registered', () => {
      const r = check(['GET /wiki'], ['GET /wiki'], {
        unregistered: ['GET /wiki'],
        paramMismatches: []
      });

      expect(r.ok).toBe(false);
      expect(r.staleBaseline).toEqual(['GET /wiki']);
    });

    // Rule 3: deleting a route must also prune its entry.
    it('fails when a baselined route no longer exists', () => {
      const r = check(['GET /users'], ['GET /users'], {
        unregistered: ['GET /deleted'],
        paramMismatches: []
      });

      expect(r.ok).toBe(false);
      expect(r.staleBaseline).toEqual(['GET /deleted']);
    });

    it('matches a baseline entry despite a param rename in the route', () => {
      // The entry was recorded as {id}; the route now spells it {userId}. Same
      // operation, so it stays suppressed rather than reading as new + stale.
      const r = check(['GET /users/{userId}/notes'], [], {
        unregistered: ['GET /users/{id}/notes'],
        paramMismatches: []
      });

      expect(r.ok).toBe(true);
      expect(r.newlyUnregistered).toEqual([]);
      expect(r.staleBaseline).toEqual([]);
    });

    it('reports several failures at once rather than stopping at the first', () => {
      const r = check(['GET /a', 'GET /b'], [], {
        unregistered: ['GET /gone'],
        paramMismatches: []
      });

      expect(r.newlyUnregistered).toEqual(['GET /a', 'GET /b']);
      expect(r.staleBaseline).toEqual(['GET /gone']);
    });
  });

  describe('formatCompletenessReport', () => {
    it('always ends with the totals line', () => {
      const out = formatCompletenessReport(check(['GET /a'], ['GET /a']));

      expect(out.trim().split('\n').pop()).toBe(
        '1 routes served, 1 operations registered, 0 unregistered (0 baselined).'
      );
    });

    it('names the offending operation and how to fix it', () => {
      const out = formatCompletenessReport(check(['GET /wiki'], []));

      expect(out).toContain('GET /wiki');
      expect(out).toContain('src/lib/openapi.ts');
      expect(out).toContain('npm run openapi:export');
    });

    it('labels a param mismatch as a warning', () => {
      const out = formatCompletenessReport(
        check(['GET /users/{id}'], ['GET /users/{userId}'])
      );

      expect(out).toContain('warning:');
      expect(out).toContain('Not a failure.');
    });

    it('explains that the baseline only shrinks', () => {
      const out = formatCompletenessReport(
        check(['GET /a'], ['GET /a'], {
          unregistered: ['GET /gone'],
          paramMismatches: []
        })
      );

      expect(out).toContain('stale');
      expect(out).toContain('only ever');
    });
  });
});
