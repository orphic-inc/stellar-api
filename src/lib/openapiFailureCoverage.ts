// Pure OpenAPI *failure-coverage* checker (#517). No I/O: the CLI wrapper
// (src/scripts/check-openapi-failure-coverage.ts) builds the real Express app,
// reads the real spec, and feeds them in — the same shape as
// openapiAuthCoverage.ts and openapiCompleteness.ts.
//
// WHERE THIS SITS IN THE STACK:
//
//   registry <-> routes that exist                  openapi:completeness (#474)
//   registry <-> what a route's GATES can answer    openapi:auth-coverage (#494)
//   registry <-> what a route's HANDLER can answer  NOTHING CHECKED THIS
//
// 154 of 364 operations declare no 4xx at all beyond the 401/403 their
// middleware implies, while the source emits 404 at 202 sites, 400 at 37, 409
// at 17 and 422 at 8.
//
// THIS AXIS DIFFERS FROM THE OTHER TWO IN KIND, AND THAT SHAPES EVERYTHING
// BELOW. #474's authority is the Express route table; #494's is middleware that
// labels itself through `lib/routeGate.ts`. Both read the thing that does the
// work, so description and behaviour cannot diverge. A handler's failure modes
// have no such structure — 121 of 151 `AppError` throws live in MODULES, a call
// or more away from the route, often behind a reason-string map with a `?? 400`
// fallback. Static analysis would be approximate, and a runtime probe has
// nothing to observe: the integration suite calls modules directly rather than
// driving HTTP.
//
// So the authority here is a HUMAN READING THE HANDLER — the method that
// produced every finding on #517 — and this checker's job is narrower than its
// two siblings': it does not derive what a handler emits. It asserts that every
// operation has been CLASSIFIED, and that the classification has not gone
// stale. New routes cannot slip in unread, which is the property that decays.
//
// WHAT IT DELIBERATELY CANNOT SEE: an operation that declares SOME
// gate-independent 4xx counts as documented, so one declaring 404 while its
// handler also throws 409 passes. `POST /auth/register` is the live example —
// it declares 200/400 and answers 403 on three branches, and this gate will
// never flag it. That is the cost of keeping the codes in one place (the
// registry) instead of duplicating them here where they could drift. The
// per-surface read catches it; the gate does not pretend to.

import { expectedCodes, type GateKind } from './routeGate';
import type { Operation } from './openapiCompleteness';

/** The two grandfathering lists. They are NOT the same kind of thing. */
export interface FailureBaseline {
  /**
   * Operations whose handler has not been read yet. Shrinks to empty — this is
   * the burn-down, one surface at a time.
   */
  unreviewed: string[];
  /**
   * Operations a human READ and found emit no gate-independent failure at all.
   * Durable, not a backlog: `/bookmarks` genuinely answers nothing but 200/204
   * and its 401, and that is a fact worth recording rather than a gap to fix.
   * Kept apart from `unreviewed` precisely so "verified silent" and "not yet
   * looked at" can never be confused — conflating them would leave a correctly
   * silent operation baselined forever, indistinguishable from an unread one.
   */
  noFailureModes: string[];
}

export interface FailureCoverageInput {
  /** Contract routes the app serves, each carrying its `gates`. */
  routes: Operation[];
  /** `METHOD /path` -> the response codes its registration declares. */
  declared: Map<string, Set<string>>;
  baseline: FailureBaseline;
}

export interface FailureCoverageResult {
  /** Declares nothing gate-independent and appears in neither list — failing. */
  unclassified: string[];
  /** In `unreviewed`, but now documented or no longer routed — failing. */
  staleUnreviewed: string[];
  /** In `noFailureModes`, but now declares a code or is gone — failing. */
  staleNoFailureModes: string[];
  totals: {
    routes: number;
    /**
     * Operations declaring AT LEAST ONE gate-independent 4xx. Not a count of
     * complete registrations — nothing here can measure completeness, and
     * treating this as "done" is the misreading to guard against.
     */
    documented: number;
    silent: number;
    unreviewed: number;
  };
  ok: boolean;
}

const key = (op: Operation): string => `${op.method} ${op.path}`;

/**
 * The 4xx codes an operation declares that its OWN GATES do not account for.
 *
 * Subtracting the gate-implied codes is what makes this axis compose with #494
 * rather than overlap it: a `403` on a `requirePermission` route is #494's to
 * measure, while a `403` thrown by the handler of an ungated route — exactly
 * `POST /auth/register` — belongs here. Same code, different origin, different
 * owner. Without the subtraction, every gated route would read as "documented"
 * on the strength of a 401 its middleware supplies.
 *
 * EXCLUDED BY CONSTRUCTION: codes from APP-LEVEL middleware. `rejectBannedIps`
 * (#540) answers 403 before routing, so every one of the 364 operations can
 * emit it and none of them owns it. Declaring it 364 times would be accurate in
 * a literal sense and would drown the per-operation distinction #494 spent
 * twenty slices establishing; OpenAPI has no top-level `responses` to say it
 * once. It is stated in `info.description` instead, and left out of this
 * measurement deliberately rather than by oversight.
 */
export const gateIndependentCodes = (
  op: Operation,
  declared: Set<string>
): string[] => {
  const implied = new Set(
    expectedCodes((op.gates ?? []) as GateKind[]).map(String)
  );
  return [...declared]
    .filter((code) => code.startsWith('4') && !implied.has(code))
    .sort();
};

export const checkFailureCoverage = (
  input: FailureCoverageInput
): FailureCoverageResult => {
  const { routes, declared, baseline } = input;
  const unreviewed = new Set(baseline.unreviewed);
  const silent = new Set(baseline.noFailureModes);

  const live = new Set(routes.map(key));
  const unclassified: string[] = [];
  const staleUnreviewed: string[] = [];
  const staleNoFailureModes: string[] = [];
  let documented = 0;

  for (const route of routes) {
    const k = key(route);

    // No registration at all is the completeness gate's business, not this
    // one. Reporting it here would double-count a single problem.
    const codes = declared.get(k);
    if (!codes) continue;

    if (gateIndependentCodes(route, codes).length > 0) {
      documented++;
      // Both lists are claims that this operation declares nothing. It now
      // does, so whichever list holds it is out of date.
      if (unreviewed.has(k)) staleUnreviewed.push(k);
      if (silent.has(k)) staleNoFailureModes.push(k);
      continue;
    }

    if (!unreviewed.has(k) && !silent.has(k)) unclassified.push(k);
  }

  // An entry naming a route the app no longer serves is stale in both lists —
  // same rule #474 and #494 use, and what stops either list rotting into a
  // permanent mute.
  for (const k of unreviewed) if (!live.has(k)) staleUnreviewed.push(k);
  for (const k of silent) if (!live.has(k)) staleNoFailureModes.push(k);

  unclassified.sort();
  staleUnreviewed.sort();
  staleNoFailureModes.sort();

  return {
    unclassified,
    staleUnreviewed,
    staleNoFailureModes,
    totals: {
      routes: routes.length,
      documented,
      silent: silent.size,
      unreviewed: unreviewed.size
    },
    ok:
      unclassified.length === 0 &&
      staleUnreviewed.length === 0 &&
      staleNoFailureModes.length === 0
  };
};

export const formatFailureCoverageReport = (
  r: FailureCoverageResult
): string => {
  const lines: string[] = [];

  if (r.unclassified.length > 0) {
    lines.push(
      `${r.unclassified.length} operation(s) declare no failure code their ` +
        `middleware does not already imply, and are in neither baseline list:`
    );
    for (const g of r.unclassified) lines.push(`  - ${g}`);
    lines.push('');
    lines.push(
      'Read the handler, then do one of two things. If it can answer a 4xx, ' +
        'add that response to its registerPath() in src/lib/openapi.ts. If it ' +
        'genuinely answers none, add it to `noFailureModes` in ' +
        'openapi-failure-coverage-baseline.json — that is a verified finding, ' +
        'not a backlog entry, so record it only after reading the handler.'
    );
    lines.push('');
  }

  if (r.staleUnreviewed.length > 0) {
    lines.push(
      `${r.staleUnreviewed.length} \`unreviewed\` entr(ies) are stale:`
    );
    for (const b of r.staleUnreviewed) lines.push(`  - ${b}`);
    lines.push('');
    lines.push(
      'Each is now documented, or no longer routed. Delete it — `unreviewed` ' +
        'only ever shrinks.'
    );
    lines.push('');
  }

  if (r.staleNoFailureModes.length > 0) {
    lines.push(
      `${r.staleNoFailureModes.length} \`noFailureModes\` entr(ies) contradict ` +
        `the contract:`
    );
    for (const b of r.staleNoFailureModes) lines.push(`  - ${b}`);
    lines.push('');
    lines.push(
      'Each was recorded as answering no failure code, but now declares one ' +
        '(or is no longer routed). The earlier reading was wrong or the route ' +
        'has changed: re-read the handler and move or delete the entry.'
    );
    lines.push('');
  }

  const { routes, documented, silent, unreviewed } = r.totals;
  // "declares one", never "documented" — this gate cannot tell a COMPLETE
  // registration from a partial one, and saying otherwise would claim a
  // property it never established. `GET /reports/{id}` declares a
  // handler-thrown 403 and still omits the 404 its handler sends: it counts
  // here, and it is not finished.
  lines.push(
    `${routes} contract routes, ${documented} declare at least one ` +
      `handler failure code, ${silent} verified silent, ${unreviewed} unreviewed.`
  );
  return lines.join('\n');
};
