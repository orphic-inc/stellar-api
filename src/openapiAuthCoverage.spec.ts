/**
 * Unit tests for the auth-coverage gate (#494).
 *
 * The whole value of a ratchet is that it fails in BOTH directions — a new gap
 * blocks, and a fixed-but-still-baselined entry blocks as stale so the list
 * cannot rot into a permanent mute. A gate only tested on its happy path would
 * be indistinguishable from one that always passes, which is the failure #271
 * and #386 are both instances of.
 */
import {
  checkAuthCoverage,
  type AuthCoverageInput
} from './lib/openapiAuthCoverage';
import type { RequestHandler } from 'express';
import { expectedCodes, markGate, readGate } from './lib/routeGate';
import {
  requireAdminOnly,
  requireOwnerOrPermission,
  requirePermission,
  requireStrictAdmin
} from './middleware/permissions';

const declared = (
  entries: Record<string, string[]>
): Map<string, Set<string>> =>
  new Map(Object.entries(entries).map(([k, v]) => [k, new Set(v)]));

const input = (over: Partial<AuthCoverageInput> = {}): AuthCoverageInput => ({
  routes: [],
  declared: declared({}),
  baseline: [],
  ...over
});

describe('expectedCodes', () => {
  it('maps requireAuth to 401 alone', () => {
    expect(expectedCodes([{ kind: 'auth' }])).toEqual([401]);
  });

  // The rule that matters: requirePermission() spreads [requireAuth, check], so
  // a permission-gated route answers 401 to an anonymous caller and 403 to an
  // authenticated one without the permission. Declaring only 403 is half a gate.
  it('maps a permission gate to BOTH 401 and 403', () => {
    expect(expectedCodes([{ kind: 'permission' }])).toEqual([401, 403]);
  });

  it('maps the service key to 401 — a Bearer failure is authentication', () => {
    expect(expectedCodes([{ kind: 'service' }])).toEqual([401]);
  });

  it('deduplicates when a chain carries the same gate twice', () => {
    expect(
      expectedCodes([
        { kind: 'auth' },
        { kind: 'permission' },
        { kind: 'auth' }
      ])
    ).toEqual([401, 403]);
  });
});

describe('markGate / readGate', () => {
  it('round-trips a gate through a handler', () => {
    const fn = markGate(jest.fn(), 'permission');
    expect(readGate(fn)).toEqual({ kind: 'permission' });
  });

  it('returns undefined for an unmarked handler rather than guessing', () => {
    expect(readGate(jest.fn())).toBeUndefined();
    expect(readGate(undefined)).toBeUndefined();
    expect(readGate('not a function')).toBeUndefined();
  });

  // The load-bearing property for "this refactor changes no auth behaviour":
  // markGate stamps and RETURNS THE SAME FUNCTION. It does not wrap, proxy or
  // rebind, so `requireAuth` is the identical object every route already had.
  it('returns the same function object, not a wrapper', () => {
    const original = jest.fn();
    expect(markGate(original, 'auth')).toBe(original);
  });

  it('does not change what the handler does when called', () => {
    const spy = jest.fn().mockReturnValue('called');
    const marked = markGate(spy, 'permission');

    expect(marked('a' as never, 'b' as never, 'c' as never)).toBe('called');
    expect(spy).toHaveBeenCalledWith('a', 'b', 'c');
  });

  it('does not make the mark enumerable — it must not leak into JSON', () => {
    const fn = markGate(jest.fn(), 'auth');
    expect(Object.keys(fn)).not.toContain('gate');
    expect(JSON.stringify({ fn })).toBe('{}');
  });
});

describe('checkAuthCoverage', () => {
  it('passes a fully documented gated route', () => {
    const r = checkAuthCoverage(
      input({
        routes: [
          { method: 'GET', path: '/x', gates: [{ kind: 'permission' }] }
        ],
        declared: declared({ 'GET /x': ['200', '401', '403'] })
      })
    );
    expect(r.ok).toBe(true);
    expect(r.totals).toMatchObject({ gated: 1, covered: 1, gaps: 0 });
  });

  it('ignores an ungated route entirely', () => {
    const r = checkAuthCoverage(
      input({
        routes: [{ method: 'GET', path: '/public' }],
        declared: declared({ 'GET /public': ['200'] })
      })
    );
    expect(r.ok).toBe(true);
    expect(r.totals.gated).toBe(0);
  });

  // Direction 1: a new gap must block.
  it('fails on a gap that is not baselined', () => {
    const r = checkAuthCoverage(
      input({
        routes: [
          { method: 'GET', path: '/x', gates: [{ kind: 'permission' }] }
        ],
        declared: declared({ 'GET /x': ['200'] })
      })
    );
    expect(r.ok).toBe(false);
    expect(r.newGaps).toEqual(['GET /x 401', 'GET /x 403']);
  });

  it('accepts a gap that IS baselined', () => {
    const r = checkAuthCoverage(
      input({
        routes: [{ method: 'GET', path: '/x', gates: [{ kind: 'auth' }] }],
        declared: declared({ 'GET /x': ['200'] }),
        baseline: ['GET /x 401']
      })
    );
    expect(r.ok).toBe(true);
    expect(r.newGaps).toEqual([]);
  });

  // Direction 2: the ratchet must notice improvement, or the list rots.
  it('fails a baselined entry that is now documented', () => {
    const r = checkAuthCoverage(
      input({
        routes: [{ method: 'GET', path: '/x', gates: [{ kind: 'auth' }] }],
        declared: declared({ 'GET /x': ['200', '401'] }),
        baseline: ['GET /x 401']
      })
    );
    expect(r.ok).toBe(false);
    expect(r.staleBaseline).toEqual(['GET /x 401']);
  });

  it('fails a baselined entry whose route no longer exists', () => {
    const r = checkAuthCoverage(input({ baseline: ['GET /gone 401'] }));
    expect(r.ok).toBe(false);
    expect(r.staleBaseline).toEqual(['GET /gone 401']);
  });

  // An unregistered route is the completeness gate's problem; counting it here
  // would report one fault twice and make both baselines move together.
  it('does not report a route that has no registration at all', () => {
    const r = checkAuthCoverage(
      input({
        routes: [{ method: 'GET', path: '/x', gates: [{ kind: 'auth' }] }]
      })
    );
    expect(r.ok).toBe(true);
    expect(r.allGaps).toEqual([]);
  });

  it('reports one gap per missing CODE, not per operation', () => {
    const r = checkAuthCoverage(
      input({
        routes: [
          { method: 'PUT', path: '/y', gates: [{ kind: 'permission' }] }
        ],
        declared: declared({ 'PUT /y': ['200'] })
      })
    );
    expect(r.allGaps).toHaveLength(2);
    expect(r.totals.gaps).toBe(2);
  });
});

/**
 * A permission gate names what it enforces (#517).
 *
 * The kind alone answers "which codes?"; the names are what let a `403` be
 * described as `Missing news_manage` rather than a bare `Permission denied`.
 * Nothing consumes them until the derivation lands, so without this the stamp
 * could be wrong — or absent — and every test would still pass.
 */
describe('permission gates name what they enforce', () => {
  const gateOf = (chain: RequestHandler[]) =>
    chain.map((h) => readGate(h)).find((g) => g?.kind === 'permission');

  it('stamps the varargs of requirePermission', () => {
    expect(gateOf(requirePermission('news_manage'))).toEqual({
      kind: 'permission',
      permissions: ['news_manage']
    });
  });

  it('keeps every alternative, because any one of them passes', () => {
    // `requirePermission` spreads into a `.some()`, so these are OR — and the
    // derived description has to read "Missing wiki_manage or admin".
    expect(gateOf(requirePermission('wiki_manage', 'admin'))).toEqual({
      kind: 'permission',
      permissions: ['wiki_manage', 'admin']
    });
  });

  it('names admin for the two admin-only helpers', () => {
    expect(gateOf(requireAdminOnly())).toEqual({
      kind: 'permission',
      permissions: ['admin']
    });
    expect(gateOf(requireStrictAdmin())).toEqual({
      kind: 'permission',
      permissions: ['admin']
    });
  });

  it('does NOT name a permission an owner can bypass', () => {
    // requireOwnerOrPermission admits the resource owner without the
    // permission, so claiming it as a requirement would describe the route
    // wrongly. Kind only — it derives the generic message instead.
    const gate = gateOf(requireOwnerOrPermission(() => 1, 'users_edit'));
    expect(gate).toEqual({ kind: 'permission' });
    expect(gate).not.toHaveProperty('permissions');
  });
});

/**
 * The stamp must not alias the array the gate evaluates.
 *
 * `requirePermission` passes the very array its closure runs `.some()` over, so
 * storing the reference would let anything holding the stamp mutate a live
 * authorization check. `permissions.ts` is a documented high-risk file; this is
 * the assertion that keeps the metadata inert.
 */
describe('a gate stamp cannot reach back into the check', () => {
  it('copies and freezes the permission list', () => {
    const chain = requirePermission('news_manage');
    const gate = chain
      .map((h) => readGate(h))
      .find((g) => g?.kind === 'permission');

    expect(Object.isFrozen(gate?.permissions)).toBe(true);
    expect(() => {
      (gate?.permissions as string[]).push('admin');
    }).toThrow();
    expect(gate?.permissions).toEqual(['news_manage']);
  });

  it('is unaffected by mutating the array the caller passed', () => {
    const perms: string[] = ['news_manage'];
    const fn = markGate(jest.fn(), 'permission', perms);
    perms.push('admin');
    expect(readGate(fn)?.permissions).toEqual(['news_manage']);
  });
});
