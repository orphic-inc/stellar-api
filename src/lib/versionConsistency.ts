// Pure version-consistency checker (#79). The manifest (package.json) is the
// single source of truth; every other version surface present on the project is
// compared against it. No I/O here — the CLI wrapper
// (src/scripts/check-version-consistency.ts) gathers the real surfaces and feeds
// them in, which keeps the comparison logic trivially unit-testable.

export interface VersionSurfaces {
  /** package.json version — the source of truth all others are compared against. */
  manifest: string;
  /** package-lock.json version. */
  lockfile: string;
  /** First dated `## [X.Y.Z]` heading in CHANGELOG.md (null when none found). */
  changelogTop?: string | null;
  /** API runtime version (src/lib/version.ts appVersion). */
  runtime?: string;
  /** Latest `vX.Y.Z` git tag, v-prefix stripped (null when no tags). */
  latestTag?: string | null;
}

export interface VersionMismatch {
  surface: string;
  expected: string;
  actual: string;
}

export interface CheckOptions {
  /** Enforce the git-tag axis. Off by default — a release bump commit
   *  legitimately runs ahead of the tag, so the tag is only checked on
   *  tag/release events in CI, never on every commit. */
  checkTag?: boolean;
}

export function checkVersionConsistency(
  surfaces: VersionSurfaces,
  opts: CheckOptions = {}
): VersionMismatch[] {
  const { manifest, lockfile, changelogTop, runtime, latestTag } = surfaces;
  const mismatches: VersionMismatch[] = [];

  const compare = (surface: string, actual: string | null | undefined) => {
    if (actual != null && actual !== manifest) {
      mismatches.push({ surface, expected: manifest, actual });
    }
  };

  compare('lockfile', lockfile);
  compare('changelog', changelogTop);
  compare('runtime', runtime);
  if (opts.checkTag) {
    compare('tag', latestTag);
  }

  return mismatches;
}
