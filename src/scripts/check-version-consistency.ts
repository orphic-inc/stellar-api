import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';
import {
  checkVersionConsistency,
  VersionSurfaces
} from '../lib/versionConsistency';
import { appVersion } from '../lib/version';

// Gathers the real version surfaces and feeds them to the pure checker (#79).
// Internal axes (lockfile, CHANGELOG, runtime) run on every invocation; the
// git-tag axis is opt-in via --check-tag so a release bump commit — which
// legitimately runs ahead of its tag — isn't blocked at pre-commit time.

const root = resolve(__dirname, '../..');

const readVersion = (file: string): string => {
  const pkg = JSON.parse(readFileSync(resolve(root, file), 'utf8')) as {
    version?: string;
  };
  return pkg.version ?? '0.0.0';
};

// First dated section heading, e.g. `## [0.5.6] - 2026-06-17`. The `[Unreleased]`
// section is intentionally skipped (no version to compare).
const readChangelogTop = (): string | null => {
  const text = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
  const match = text.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
  return match ? match[1] : null;
};

const readLatestTag = (): string | null => {
  try {
    const out = execFileSync(
      'git',
      ['tag', '--list', 'v[0-9]*', '--sort=-v:refname'],
      { cwd: root, encoding: 'utf8' }
    );
    const latest = out.split('\n').find((l) => l.trim().length > 0);
    return latest ? latest.trim().replace(/^v/, '') : null;
  } catch {
    // Not a git repo, shallow clone, or git unavailable — skip the tag axis.
    return null;
  }
};

const checkTag = process.argv.includes('--check-tag');

const surfaces: VersionSurfaces = {
  manifest: readVersion('package.json'),
  lockfile: readVersion('package-lock.json'),
  changelogTop: readChangelogTop(),
  runtime: appVersion,
  latestTag: checkTag ? readLatestTag() : undefined
};

const mismatches = checkVersionConsistency(surfaces, { checkTag });

if (mismatches.length > 0) {
  console.error(`Version drift detected (manifest is ${surfaces.manifest}):`);
  for (const m of mismatches) {
    console.error(
      `  ✗ ${m.surface}: expected ${m.expected}, found ${m.actual}`
    );
  }
  console.error(
    '\nRealign every surface to the manifest version before committing.'
  );
  process.exit(1);
}

console.log(
  `Version surfaces consistent at ${surfaces.manifest}${
    checkTag ? ' (incl. git tag)' : ''
  }.`
);
