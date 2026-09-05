// CLI wrapper for the auth-coverage gate (#494). Mirrors
// check-openapi-completeness.ts: build the real app, read the real spec, feed
// both into the pure checker in lib/openapiAuthCoverage.ts.
//
// Usage:
//   npm run openapi:auth-coverage
//   npm run openapi:auth-coverage -- --write-baseline
//
// Exits 0 clean, 1 on a new gap or a stale baseline entry.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createApp } from '../app';
import { collectRoutes } from '../lib/expressRoutes';
import { buildOpenApiDocument } from '../lib/openapi';
import { isContractRoute, stripApi } from '../lib/openapiCompleteness';
import {
  checkAuthCoverage,
  formatAuthCoverageReport
} from '../lib/openapiAuthCoverage';

const ROOT = resolve(__dirname, '../..');
const BASELINE_PATH = resolve(ROOT, 'openapi-auth-coverage-baseline.json');

const readBaseline = (): string[] => {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as {
      gaps?: string[];
    };
    return parsed.gaps ?? [];
  } catch {
    // Absent or unreadable baseline means "nothing grandfathered", which fails
    // loudly rather than silently passing — the same choice #474 made.
    return [];
  }
};

const main = (): void => {
  const writing = process.argv.includes('--write-baseline');

  const app = createApp();
  const routes = collectRoutes(app).filter(isContractRoute).map(stripApi);

  const doc = buildOpenApiDocument() as unknown as {
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

  const result = checkAuthCoverage({
    routes,
    declared,
    baseline: writing ? [] : readBaseline()
  });

  if (writing) {
    const baseline = {
      $comment:
        'Grandfathered gaps for the OpenAPI auth-coverage gate (#494): gated ' +
        'operations that do not document the 401/403 their middleware can ' +
        'answer. One entry is one (operation, code) pair. This list only ever ' +
        'SHRINKS — document the response, then delete its line. A stale entry ' +
        '(now documented, or no longer routed) fails the check, so the list ' +
        'cannot rot into a permanent mute. Regenerate with ' +
        '`npm run openapi:auth-coverage -- --write-baseline`.',
      generated: new Date().toISOString().slice(0, 10),
      gaps: result.allGaps
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `Wrote ${result.allGaps.length} auth-coverage gaps to ` +
        'openapi-auth-coverage-baseline.json'
    );
    process.exit(0);
  }

  console.log(formatAuthCoverageReport(result));
  process.exit(result.ok ? 0 : 1);
};

main();
