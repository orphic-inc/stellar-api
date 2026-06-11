import { readFileSync } from 'fs';
import { resolve } from 'path';

// Single source for the running API version, read from the package manifest at
// module load. __dirname resolves package.json two levels up under both ts-node
// (src/lib) and the compiled build (dist/lib), so the value tracks the manifest
// without a build-time codegen step. Falls back to 0.0.0 if the read fails.
export const appVersion: string = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../package.json'), 'utf8')
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
