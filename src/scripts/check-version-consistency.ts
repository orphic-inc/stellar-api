import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';
import {
  checkVersionConsistency,
  VersionSurfaces
} from '../lib/versionConsistency';
import { appVersion } from '../lib/version';

// Gathers the real version surfaces and feeds them to the pure checker (#79).
// Internal axes (lockfile, CHANGELOG, runtime, openapi) run on every
// invocation; the git-tag axis is opt-in via --check-tag so a release bump
// commit — which legitimately runs ahead of its tag — isn't blocked at
// pre-commit time.

const root = resolve(__dirname, '../..');

const readVersion = (file: string): string => {
  const pkg = JSON.parse(readFileSync(resolve(root, file), 'utf8')) as {
    version?: string;
  };
  return pkg.version ?? '0.0.0';
};

// `info.version` from the committed spec (#538). Read strictly, like the
// lockfile: openapi.json is committed and CI regenerates and diffs it, so a
// missing file is a broken checkout rather than an axis to skip quietly. A spec
// somehow carrying no version falls back to 0.0.0 and fails loudly, which is
// the right answer for an export that produced nothing.
const readOpenApiVersion = (): string => {
  const doc = JSON.parse(
    readFileSync(resolve(root, 'openapi.json'), 'utf8')
  ) as {
    info?: { version?: string };
  };
  return doc.info?.version ?? '0.0.0';
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
  openapi: readOpenApiVersion(),
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
  // openapi.json is generated, so the generic advice above would send someone
  // to hand-edit it — and a hand-edited spec then fails CI's OpenAPI freshness
  // diff instead. Name the command that actually fixes it.
  if (mismatches.some((m) => m.surface === 'openapi')) {
    console.error(
      'openapi.json is generated — run `npm run openapi:export` rather than editing it.'
    );
  }
  process.exit(1);
}

console.log(
  `Version surfaces consistent at ${surfaces.manifest}${
    checkTag ? ' (incl. git tag)' : ''
  }.`
);
