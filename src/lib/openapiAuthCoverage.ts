// Pure OpenAPI *auth-coverage* checker (#494). No I/O: the CLI wrapper
// (src/scripts/check-openapi-auth-coverage.ts) builds the real Express app,
// reads the real spec, and feeds them in — the same shape as
// openapiCompleteness.ts and versionConsistency.ts.
//
// WHY THIS EXISTS, given #474 already closed:
//
//   registry <-> routes that exist            guarded (openapi:completeness)
//   registry <-> what a gated route ANSWERS   NOTHING CHECKED THIS
//
// #474 proved every route is registered. It never claimed a registration was
// complete per operation, and auth failure modes were the largest gap left: of
// 361 operations only 39 declared a 401 and 88 a 403, and the three axes (401,
// 403, `security`) did not correlate — drift, not policy. `Tools` was the
// sharpest case: 16 `requirePermission` calls across the file and zero
// documented 403s, so a generated client saw an admin-only CRUD surface with no
// authorization failure to handle.
//
// The authority is the middleware chain, which `lib/routeGate.ts` now labels so
// it can be read off the built app instead of guessed at. This compares that to
// what each operation declares.
//
// Shrink-only baseline, exactly like #474's: a NEW gap fails immediately, and a
// baselined entry that is now covered (or no longer routed) fails as stale. The
// backlog can only get smaller.

import { expectedCodes, type GateKind } from './routeGate';
import type { Operation } from './openapiCompleteness';

export interface AuthCoverageInput {
  /** Contract routes the app serves, each carrying its `gates`. */
  routes: Operation[];
  /** `METHOD /path` -> the response codes its registration declares. */
  declared: Map<string, Set<string>>;
  /** Grandfathered gaps: `METHOD /path 401` entries. */
  baseline: string[];
}

export interface AuthCoverageResult {
  /** Gaps NOT in the baseline — the failing set. */
  newGaps: string[];
  /** Baselined entries now covered, or whose route/gate is gone — also failing. */
  staleBaseline: string[];
  /** Every gap, baselined or not (for reporting). */
  allGaps: string[];
  totals: {
    routes: number;
    gated: number;
    covered: number;
    gaps: number;
    baselined: number;
  };
  ok: boolean;
}

const key = (op: Operation): string => `${op.method} ${op.path}`;

/** `GET /users 401` — one gap is one (operation, code) pair, not one operation. */
export const gapKey = (op: Operation, code: number): string =>
  `${key(op)} ${code}`;

export const checkAuthCoverage = (
  input: AuthCoverageInput
): AuthCoverageResult => {
  const { routes, declared, baseline } = input;
  const baselined = new Set(baseline);

  const allGaps: string[] = [];
  let gated = 0;
  let covered = 0;

  for (const route of routes) {
    const gates = (route.gates ?? []) as GateKind[];
    if (gates.length === 0) continue;
    gated++;

    // A route with no registration at all is the completeness gate's business,
    // not this one. Reporting it here would double-count one problem.
    const codes = declared.get(key(route));
    if (!codes) continue;

    const missing = expectedCodes(gates).filter((c) => !codes.has(String(c)));
    if (missing.length === 0) covered++;
    for (const code of missing) allGaps.push(gapKey(route, code));
  }

  allGaps.sort();
  const gapSet = new Set(allGaps);
  const newGaps = allGaps.filter((g) => !baselined.has(g));
  const staleBaseline = [...baselined].filter((b) => !gapSet.has(b)).sort();

  return {
    newGaps,
    staleBaseline,
    allGaps,
    totals: {
      routes: routes.length,
      gated,
      covered,
      gaps: allGaps.length,
      baselined: baseline.length
    },
    ok: newGaps.length === 0 && staleBaseline.length === 0
  };
};

export const formatAuthCoverageReport = (r: AuthCoverageResult): string => {
  const lines: string[] = [];

  if (r.newGaps.length > 0) {
    lines.push(
      `${r.newGaps.length} gated operation(s) do not document the code their ` +
        `middleware can answer, and are not baselined:`
    );
    for (const g of r.newGaps) lines.push(`  - ${g}`);
    lines.push('');
    lines.push(
      'Add the response to its registerPath() in src/lib/openapi.ts. A route ' +
        'behind requireAuth can answer 401; one behind requirePermission can ' +
        'answer BOTH 401 and 403, because requirePermission spreads ' +
        '[requireAuth, check].'
    );
    lines.push('');
  }

  if (r.staleBaseline.length > 0) {
    lines.push(`${r.staleBaseline.length} baseline entr(ies) are stale:`);
    for (const b of r.staleBaseline) lines.push(`  - ${b}`);
    lines.push('');
    lines.push(
      'Remove them from openapi-auth-coverage-baseline.json. The baseline only ' +
        'ever shrinks.'
    );
    lines.push('');
  }

  const { routes, gated, covered, gaps, baselined } = r.totals;
  lines.push(
    `${routes} contract routes, ${gated} gated, ${covered} fully documented, ` +
      `${gaps} gap(s) (${baselined} baselined).`
  );
  return lines.join('\n');
};
