// CLI wrapper for the validator-handle gate (#234). Feeds every non-test source
// file under src/ to the pure checker in lib/validateHandles.ts.

import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';

import {
  DEFINING_FILES,
  checkValidateHandles,
  countBypasses,
  formatHandlesReport,
  type Counts
} from '../lib/validateHandles';

const ROOT = resolve(__dirname, '../..');
const SRC = resolve(ROOT, 'src');
const BASELINE_PATH = resolve(ROOT, 'validate-handles-baseline.json');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(entry.name) &&
      !/\.(spec|integration)\.ts$/.test(entry.name)
      ? [path]
      : [];
  });

const readBaseline = (): Counts => {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).files ?? {};
  } catch {
    // Missing means nothing is grandfathered: every read is reported.
    return {};
  }
};

const main = (): void => {
  const counts: Counts = {};
  for (const path of sourceFiles(SRC)) {
    const file = relative(SRC, path);
    if (DEFINING_FILES.includes(file)) continue;
    const n = countBypasses(readFileSync(path, 'utf8'));
    if (n > 0) counts[file] = n;
  }

  if (process.argv.includes('--write-baseline')) {
    const baseline = {
      $comment:
        'Unchecked validator reads still to convert (#234). This list only ' +
        'SHRINKS: convert a file to validator handles, then lower or delete ' +
        'its entry. A count above or below its entry fails the check. ' +
        'Regenerate with `npm run validate:handles -- --write-baseline`.',
      files: counts
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `Wrote ${Object.keys(counts).length} files to validate-handles-baseline.json`
    );
    process.exit(0);
  }

  const result = checkValidateHandles(counts, readBaseline());
  console.log(formatHandlesReport(counts, result));
  process.exit(result.ok ? 0 : 1);
};

main();
