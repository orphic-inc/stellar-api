// CLI wrapper for the failure-coverage gate (#517). Mirrors
// check-openapi-auth-coverage.ts: build the real app, read the real spec, feed
// both into the pure checker in lib/openapiFailureCoverage.ts.
//
// Usage:
//   npm run openapi:failure-coverage
//   npm run openapi:failure-coverage -- --write-baseline
//
// Exits 0 clean, 1 on an unclassified operation or a stale baseline entry.
//
// `--write-baseline` writes every currently-undocumented operation to
// `unreviewed` and NEVER to `noFailureModes`. That asymmetry is deliberate: a
// machine can see that an operation declares nothing, but only a person reading
// the handler can say it answers nothing, and those are the two claims the file
// exists to keep apart. Regenerating must never silently promote the second.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createApp } from '../app';
import { collectRoutes } from '../lib/expressRoutes';
import { buildOpenApiDocument } from '../lib/openapi';
import {
  isContractRoute,
  stripApi,
  type Operation
} from '../lib/openapiCompleteness';
import {
  checkFailureCoverage,
  formatFailureCoverageReport,
  gateIndependentCodes,
  type FailureBaseline
} from '../lib/openapiFailureCoverage';

const ROOT = resolve(__dirname, '../..');
const BASELINE_PATH = resolve(ROOT, 'openapi-failure-coverage-baseline.json');

const EMPTY: FailureBaseline = { unreviewed: [], noFailureModes: [] };

const readBaseline = (): FailureBaseline => {
  try {
    const parsed = JSON.parse(
      readFileSync(BASELINE_PATH, 'utf8')
    ) as Partial<FailureBaseline>;
    return {
      unreviewed: parsed.unreviewed ?? [],
      noFailureModes: parsed.noFailureModes ?? []
    };
  } catch {
    // Absent or unreadable means "nothing grandfathered", which fails loudly
    // rather than silently passing — the same choice #474 and #494 made.
    return EMPTY;
  }
};

const BASELINE_COMMENT =
  'Grandfathered operations for the OpenAPI failure-coverage gate (#517): ' +
  'operations that do not document any 4xx beyond the 401/403 their ' +
  'middleware already implies. TWO LISTS, TWO MEANINGS. `unreviewed` is the ' +
  'burn-down — nobody has read the handler yet — and only ever SHRINKS: read ' +
  'the surface, declare the codes in src/lib/openapi.ts, then delete the ' +
  'line. `noFailureModes` is the opposite, a DURABLE record that someone read ' +
  'the handler and found it answers no failure code at all; add to it only ' +
  'from a real reading, never from a regeneration. An entry in either list ' +
  'that is now documented, or no longer routed, fails the check, so neither ' +
  'can rot into a permanent mute. Regenerate `unreviewed` with ' +
  '`npm run openapi:failure-coverage -- --write-baseline`; that command ' +
  'preserves `noFailureModes` and never adds to it.';

/** `METHOD /path` -> the response codes its registration declares. */
const buildDeclaredMap = (routes: Operation[]): Map<string, Set<string>> => {
  const doc = buildOpenApiDocument(routes) as unknown as {
    paths?: Record<
      string,
      Record<string, { responses?: Record<string, unknown> }>
    >;
  };
  const declared = new Map<string, Set<string>>();
  for (const [path, ops] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(ops)) {
      declared.set(
        `${method.toUpperCase()} ${path}`,
        new Set(Object.keys(op.responses ?? {}))
      );
    }
  }
  return declared;
};

/**
 * Rewrite `unreviewed` from the current contract, preserving `noFailureModes`.
 *
 * The asymmetry is the point: a machine can see that an operation declares
 * nothing, but only a person reading the handler can say it ANSWERS nothing.
 * Regeneration must never silently promote the first into the second.
 */
const writeBaseline = (
  routes: Operation[],
  declared: Map<string, Set<string>>
): void => {
  const silent = new Set(readBaseline().noFailureModes);
  // Iterate the ROUTES, not their keys: `gateIndependentCodes` needs each
  // route's own `gates` to subtract what its middleware already implies.
  // Passing a gateless stand-in counts every 401/403 as a handler code and
  // writes a baseline of 3 entries instead of 149 — measured, when a refactor
  // briefly did exactly that. The failure is loud rather than silent (the next
  // run reports 146 unclassified and exits 1), but the route is the unit here,
  // and reducing it to a key throws away the half that makes the sum correct.
  const unreviewed = routes
    .filter((route) => {
      const codes = declared.get(`${route.method} ${route.path}`);
      return (
        codes !== undefined && gateIndependentCodes(route, codes).length === 0
      );
    })
    .map((route) => `${route.method} ${route.path}`)
    .filter((k) => !silent.has(k))
    .sort();

  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        $comment: BASELINE_COMMENT,
        generated: new Date().toISOString().slice(0, 10),
        unreviewed,
        noFailureModes: [...silent].sort()
      },
      null,
      2
    )}\n`
  );
  console.log(
    `Wrote ${unreviewed.length} unreviewed operation(s) to ` +
      `openapi-failure-coverage-baseline.json ` +
      `(${silent.size} noFailureModes entr(ies) preserved).`
  );
};

const main = (): void => {
  const app = createApp();
  const routes = collectRoutes(app).filter(isContractRoute).map(stripApi);
  const declared = buildDeclaredMap(routes);

  if (process.argv.includes('--write-baseline')) {
    writeBaseline(routes, declared);
    process.exit(0);
  }

  const result = checkFailureCoverage({
    routes,
    declared,
    baseline: readBaseline()
  });

  console.log(formatFailureCoverageReport(result));
  process.exit(result.ok ? 0 : 1);
};

main();
