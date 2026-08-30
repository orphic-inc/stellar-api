// CLI wrapper for the changelog gate (#386). Gathers the changed-file list and
// feeds it to the pure checker in lib/changelogGate.ts, mirroring the split
// check-version-consistency.ts uses.
//
// Two input paths, because the gate has two callers:
//
//   - CI pipes the list in on stdin. It comes from the GitHub API rather than
//     git, because no job in publish.yml sets `fetch-depth` — the runner's
//     checkout is shallow, so `base...head` is not resolvable locally there.
//   - Locally, with nothing on stdin, it falls back to diffing against
//     origin/main so an author can check before pushing.
//
// Run:
//   git diff --name-only origin/main...HEAD | npm run changelog:check
//   npm run changelog:check                      # same, computed for you
//   printf 'src/x.ts\n' | npm run changelog:check --silent
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  checkChangelogGate,
  CHANGELOG_PATH,
  ENTRY_REQUIRED_PREFIXES
} from '../lib/changelogGate';

const root = resolve(__dirname, '../..');

/** Everything on stdin, or '' when stdin is a TTY or empty. */
const readStdin = (): string => {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
};

/**
 * Local fallback: everything this branch would bring to main.
 *
 * Three sources, unioned, because any one alone lies to the author at exactly
 * the moment they would run this. Committed-only misses work still in the
 * working tree; tracked-only misses new files, which is the common case when
 * adding a module. Reporting "gate not engaged" while three new `src/` files sit
 * uncommitted is worse than having no local check at all.
 */
const readGitChanges = (): string => {
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  try {
    return [
      git(['diff', '--name-only', 'origin/main...HEAD']), // committed here
      git(['diff', '--name-only', 'HEAD']), // staged + unstaged
      git(['ls-files', '--others', '--exclude-standard']) // untracked
    ].join('\n');
  } catch {
    console.error(
      'Could not determine changed files: nothing on stdin, and reading the working tree failed.\n' +
        'Pipe a file list in instead:  git diff --name-only origin/main...HEAD | npm run changelog:check'
    );
    process.exit(2);
  }
};

const raw = readStdin().trim() || readGitChanges();
const changedFiles = raw.split('\n');

const result = checkChangelogGate(changedFiles);

if (result.failed) {
  const shown = result.triggeringPaths.slice(0, 10);
  console.error(
    `This change touches shipping code but does not update ${CHANGELOG_PATH}:`
  );
  for (const path of shown) console.error(`  ✗ ${path}`);
  if (result.triggeringPaths.length > shown.length) {
    console.error(
      `  … and ${result.triggeringPaths.length - shown.length} more`
    );
  }
  console.error(
    `\nAdd an entry under [Unreleased]. The release job publishes that section verbatim as\n` +
      `the GitHub Release notes, so anything missing here is missing there permanently.\n\n` +
      `If this genuinely warrants no entry, apply the \`no-changelog\` label to the PR.\n` +
      `Paths that oblige an entry: ${ENTRY_REQUIRED_PREFIXES.join(', ')}`
  );
  process.exit(1);
}

console.log(
  result.triggeringPaths.length === 0
    ? 'Changelog gate not engaged (no shipping-code changes).'
    : `Changelog updated alongside ${result.triggeringPaths.length} shipping-code change(s).`
);
