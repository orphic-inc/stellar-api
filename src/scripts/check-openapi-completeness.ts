// CLI wrapper for the OpenAPI completeness gate (#474). Gathers the real
// surfaces and feeds them to the pure checker in lib/openapiCompleteness.ts.
//
// Jobs must not start just because we want to read the route table, so this is
// set before app.ts is imported — createApp() reads it at call time, but the
// import graph is evaluated first and some job modules schedule on import.
process.env.DISABLE_BACKGROUND_JOBS = '1';

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import { createApp } from '../app';
import { collectRoutes } from '../lib/expressRoutes';
import { buildOpenApiDocument } from '../lib/openapi';
import {
  checkOpenapiCompleteness,
  formatCompletenessReport,
  isContractRoute,
  stripApi,
  type Baseline,
  type Operation
} from '../lib/openapiCompleteness';

const ROOT = resolve(__dirname, '../..');
const BASELINE_PATH = resolve(ROOT, 'openapi-completeness-baseline.json');

const emptyBaseline: Baseline = { unregistered: [], paramMismatches: [] };

const readBaseline = (): Baseline => {
  try {
    const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    return {
      unregistered: raw.unregistered ?? [],
      paramMismatches: raw.paramMismatches ?? []
    };
  } catch {
    // A missing baseline means "nothing is grandfathered", which is the correct
    // reading: every gap is then reported. It must never mean "skip the check".
    return emptyBaseline;
  }
};

const main = (): void => {
  const writing = process.argv.includes('--write-baseline');

  const app = createApp();
  const routes = collectRoutes(app).filter(isContractRoute).map(stripApi);

  // `paths` is typed as PathItemObject, whose optional-keys shape is not
  // assignable to a plain index signature; we only need the method names, so
  // widen through `unknown` rather than importing the OpenAPI types here.
  const doc = buildOpenApiDocument() as unknown as {
    paths?: Record<string, Record<string, unknown>>;
  };
  const registered: Operation[] = [];
  for (const [path, ops] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(ops)) {
      registered.push({ method: method.toUpperCase(), path });
    }
  }

  const result = checkOpenapiCompleteness({
    routes,
    registered,
    baseline: writing ? emptyBaseline : readBaseline()
  });

  if (writing) {
    const baseline = {
      $comment:
        'Grandfathered gaps for the OpenAPI completeness gate (#474). This list ' +
        'only ever SHRINKS: register a route, then delete its line. A stale entry ' +
        '(now registered, or no longer routed) fails the check, so the list cannot ' +
        'rot into a permanent mute. Regenerate with `npm run openapi:completeness -- --write-baseline`.',
      generated: new Date().toISOString().slice(0, 10),
      unregistered: result.allUnregistered,
      paramMismatches: result.newParamMismatches
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `Wrote ${result.allUnregistered.length} unregistered and ` +
        `${result.newParamMismatches.length} param-mismatch entries to ` +
        'openapi-completeness-baseline.json'
    );
    process.exit(0);
  }

  console.log(formatCompletenessReport(result));
  process.exit(result.ok ? 0 : 1);
};

main();
