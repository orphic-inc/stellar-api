// CLI wrapper for the gate-mark check (#558). Mirrors
// check-openapi-completeness.ts: build the real app, and feed its routes to the
// pure checker in lib/gateMarkCoverage.ts.
//
// It reads the real app, not apiTestHarness's, deliberately. The harness mocks
// `requireAuth` away, so its route table is not the one that ships.
//
// Usage: npm run openapi:gate-marks. Exits 0 clean, 1 on an unmarked layer.
process.env.DISABLE_BACKGROUND_JOBS = '1';

import { createApp } from '../app';
import { collectRoutes } from '../lib/expressRoutes';
import { checkGateMarks, formatGateMarkReport } from '../lib/gateMarkCoverage';

const result = checkGateMarks(collectRoutes(createApp()));
console.log(formatGateMarkReport(result));
process.exit(result.ok ? 0 : 1);
