// Pure OpenAPI *completeness* checker (#474). Mirrors the shape of
// versionConsistency.ts: no I/O here, so the comparison is trivially testable;
// the CLI wrapper (src/scripts/check-openapi-completeness.ts) builds the real
// Express app, reads the real openapi.json, and feeds them in.
//
// WHY THIS EXISTS, given CI already has an OpenAPI gate:
//
//   openapi.json  <->  the registry in lib/openapi.ts   guarded (freshness, ADR-0018)
//   the registry  <->  the routes that actually exist   NOTHING CHECKED THIS
//
// The freshness gate proves the committed spec matches the registry. It cannot
// prove the registry matches the routes, because `lib/openapi.ts` is a MANUAL
// registry — a route that exists but is never registered is invisible to
// openapi.json, so stellar-ui's generated types cannot see it and the UI cannot
// consume it type-safely. #198 treated one instance as a one-off; the audit in
// #474 found 91 across 16 route files.
//
// Same failure shape as #386 (the changelog rotted because nothing compared it
// to anything) and stellar-ui #271 (the vendored spec drifted because the gate
// compared version strings). A manual registry with no completeness check
// drifts, and it is silent in both directions: the UI cannot consume what is
// missing, and openapi.json asserts a contract narrower than what ships.

/** One HTTP operation, as `METHOD /path` with `{param}` placeholders. */
export interface Operation {
  method: string;
  path: string;
  /** Auth gates the route's middleware chain enforces (#494). Optional: the
   *  registered side of a comparison has no middleware to read. */
  gates?: string[];
}

/**
 * Routes deliberately outside the contract:
 *   /api/dev/*   dev-only tooling, never shipped to a member-facing UI
 *   /api/docs/*  the Swagger UI and the spec document itself
 *   /health, /   liveness and root, outside /api entirely
 *
 * Lives here rather than in a CLI so the completeness gate and the auth-coverage
 * gate (#494) share ONE definition of what is in the contract. Two copies of
 * this predicate would be the same duplicate-description problem both gates
 * exist to catch.
 */
export const isContractRoute = (op: Operation): boolean =>
  op.path.startsWith('/api/') &&
  !op.path.startsWith('/api/dev/') &&
  !op.path.startsWith('/api/docs');

/**
 * openapi.json writes paths WITHOUT the `/api` prefix, because the served spec
 * declares `/api` as the server base. Strip it so both sides speak one dialect.
 * `gates` are carried through — they are the whole input to the auth gate.
 */
export const stripApi = (op: Operation): Operation => ({
  method: op.method,
  path: op.path.replace(/^\/api/, '') || '/',
  ...(op.gates ? { gates: op.gates } : {})
});

export interface CompletenessInput {
  /** Every operation the mounted Express app actually serves. */
  routes: Operation[];
  /** Every operation registered in lib/openapi.ts (as openapi.json paths). */
  registered: Operation[];
  /** Grandfathered gaps — see BaselineFile. */
  baseline: Baseline;
}

export interface Baseline {
  /** `METHOD /path` entries known to be unregistered, tolerated for now. */
  unregistered: string[];
  /** `METHOD /path` entries whose registered param NAMES differ from the code. */
  paramMismatches: string[];
}

export interface CompletenessResult {
  /** Unregistered and NOT in the baseline — the failing set. */
  newlyUnregistered: string[];
  /** In the baseline but now registered, or no longer routed — stale entries. */
  staleBaseline: string[];
  /** Registered under a different param name, and not baselined. Warning only. */
  newParamMismatches: string[];
  /** Every unregistered operation, baselined or not (for reporting). */
  allUnregistered: string[];
  /** Counts, for the one-line summary. */
  totals: {
    routes: number;
    registered: number;
    unregistered: number;
    baselined: number;
  };
  /** True when nothing fails. Param mismatches do not fail; see below. */
  ok: boolean;
}

/** Ignore param NAMES so `/{id}` and `/{userId}` compare equal. */
const shapeOf = (path: string): string => path.replace(/\{[^}]+\}/g, '{}');

const keyOf = (op: Operation): string => `${op.method} ${op.path}`;
const shapeKeyOf = (op: Operation): string =>
  `${op.method} ${shapeOf(op.path)}`;

/**
 * Compare the routes an app serves against the operations the registry
 * declares.
 *
 * The baseline is a RATCHET, not a mute button. Three rules make it
 * un-rottable, which is the whole point — a suppression list nothing audits is
 * how the original gap survived:
 *
 *   1. An unregistered route absent from the baseline FAILS. New routes are
 *      gated from the day this lands, without waiting for the backlog.
 *   2. A baseline entry that is now registered FAILS as stale, so the list
 *      shrinks as the backlog burns down and cannot silently over-suppress.
 *   3. A baseline entry that no longer matches any route FAILS the same way, so
 *      deleting a route also prunes its entry.
 *
 * Param-name mismatches are reported but do NOT fail. They are harmless for
 * path matching — Express and the spec agree on the shape — and only cost the
 * generated types a differing param name. Failing on them would put cosmetic
 * findings on the same footing as a route the UI cannot see at all.
 */
export const checkOpenapiCompleteness = ({
  routes,
  registered,
  baseline
}: CompletenessInput): CompletenessResult => {
  const registeredShapes = new Set(registered.map(shapeKeyOf));
  const registeredExact = new Set(registered.map(keyOf));
  const routeShapes = new Set(routes.map(shapeKeyOf));

  const unregistered = routes.filter(
    (r) => !registeredShapes.has(shapeKeyOf(r))
  );
  const allUnregistered = unregistered.map(keyOf).sort();

  // Matched on SHAPE, like everything else here. Renaming `:id` to `:userId` in
  // a route does not create a new operation, so it must not un-suppress a
  // grandfathered gap — otherwise a cosmetic rename fails the build with a
  // "route not registered" message about a route that was already baselined.
  const baselinedShapes = new Set(
    baseline.unregistered.map((entry) => {
      const [method, ...rest] = entry.split(' ');
      return `${method} ${shapeOf(rest.join(' '))}`;
    })
  );
  const newlyUnregistered = unregistered
    .filter((r) => !baselinedShapes.has(shapeKeyOf(r)))
    .map(keyOf)
    .sort();

  // Rule 2 + 3: a baselined entry is stale once it is registered, or once the
  // route behind it is gone. Both mean the list is describing a world that has
  // moved on.
  const staleBaseline = baseline.unregistered
    .filter((entry) => {
      const [method, ...rest] = entry.split(' ');
      const path = rest.join(' ');
      const shapeKey = `${method} ${shapeOf(path)}`;
      const stillRouted = routeShapes.has(shapeKey);
      const nowRegistered = registeredShapes.has(shapeKey);
      return nowRegistered || !stillRouted;
    })
    .sort();

  // Registered under a matching shape, but a different param spelling.
  const baselinedMismatches = new Set(baseline.paramMismatches);
  const newParamMismatches = routes
    .filter(
      (r) =>
        registeredShapes.has(shapeKeyOf(r)) && !registeredExact.has(keyOf(r))
    )
    .map(keyOf)
    .filter((k) => !baselinedMismatches.has(k))
    .sort();

  return {
    newlyUnregistered,
    staleBaseline,
    newParamMismatches,
    allUnregistered,
    totals: {
      routes: routes.length,
      registered: registered.length,
      unregistered: allUnregistered.length,
      baselined: baseline.unregistered.length
    },
    ok: newlyUnregistered.length === 0 && staleBaseline.length === 0
  };
};

/**
 * Render the result for a terminal or a CI log. Kept here rather than in the
 * CLI so the exact wording is covered by the spec.
 */
export const formatCompletenessReport = (r: CompletenessResult): string => {
  const lines: string[] = [];
  const { routes, registered, unregistered, baselined } = r.totals;

  if (r.newlyUnregistered.length > 0) {
    lines.push(
      `${r.newlyUnregistered.length} route(s) are not registered in src/lib/openapi.ts:`,
      ...r.newlyUnregistered.map((k) => `  - ${k}`),
      '',
      'An unregistered route is invisible to openapi.json, so stellar-ui cannot',
      'consume it type-safely. Register it there, then re-run `npm run openapi:export`.',
      ''
    );
  }

  if (r.staleBaseline.length > 0) {
    lines.push(
      `${r.staleBaseline.length} baseline entr(ies) are stale — now registered, or no longer routed:`,
      ...r.staleBaseline.map((k) => `  - ${k}`),
      '',
      'Remove them from openapi-completeness-baseline.json. The baseline only ever',
      'shrinks; a stale entry means it is suppressing something that no longer needs it.',
      ''
    );
  }

  if (r.newParamMismatches.length > 0) {
    lines.push(
      `warning: ${r.newParamMismatches.length} route(s) are registered under a different param name:`,
      ...r.newParamMismatches.map((k) => `  - ${k}`),
      '',
      'Harmless for path matching; it only makes the generated types name the param',
      'differently from the route. Not a failure.',
      ''
    );
  }

  lines.push(
    `${routes} routes served, ${registered} operations registered, ` +
      `${unregistered} unregistered (${baselined} baselined).`
  );

  return lines.join('\n');
};
