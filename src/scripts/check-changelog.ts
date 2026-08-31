// CLI wrapper for the changelog gate (#386). Gathers the changed-file list and
// feeds it to the pure checker in lib/changelogGate.ts, mirroring the split
// check-version-consistency.ts uses.
//
// Two input paths, because the gate has two callers, and the caller SAYS which
// one it is rather than the script inferring it from the state of fd 0:
//
//   - CI sets `CHANGELOG_STDIN=1` and pipes the list in. It comes from the
//     GitHub API rather than git, because no job in publish.yml sets
//     `fetch-depth` — the runner's checkout is shallow, so `base...head` is not
//     resolvable there.
//   - Locally, with neither set, it diffs against origin/main so an author can
//     check before pushing. fd 0 is never touched on this path.
//
// The flag is not ceremony. This script used to read fd 0 unconditionally and
// fall back when it came back empty, which cannot work: `readFileSync(0)` blocks
// until EOF, and "nothing is on stdin" is indistinguishable from "the writer has
// not written yet" until the writer closes. A caller that inherits an open stdin
// it never writes to or closes — an editor task runner, a CI shell, an agent
// harness — hung forever. One such invocation sat blocked for fifteen hours.
// The old docstring claimed the read returned '' "when stdin is a TTY", which
// was never true: reading a TTY blocks waiting for the user, and nothing in the
// code checked isTTY.
//
// The env var is the primary switch rather than the `--stdin` argv flag, because
// argv does not survive npm reliably: `npm run x --silent -- --stdin` forwards the
// flag under npm 10 and drops it under npm 11, and CI runs Node 24 (npm 11) while
// a dev box may be on Node 22 (npm 10). That divergence already cost one red
// build that passed every local check. An env var is parsed by no one.
//
// Run:
//   npm run changelog:check                                    # local, computed
//   git diff --name-only origin/main...HEAD \
//     | CHANGELOG_STDIN=1 npm run changelog:check
//   printf 'src/x.ts\n' | CHANGELOG_STDIN=1 npm run changelog:check --silent
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  checkChangelogGate,
  CHANGELOG_PATH,
  ENTRY_REQUIRED_PREFIXES
} from '../lib/changelogGate';

const root = resolve(__dirname, '../..');

/**
 * Everything on stdin, read to EOF. Only ever called under `--stdin`, because
 * this call blocks until the writer closes and there is no sound way to ask
 * "is anything coming?" first.
 */
const readStdin = (): string => {
  if (process.stdin.isTTY) {
    // --stdin from a terminal is a caller mistake: the read would block on
    // keyboard input until Ctrl-D and look like a hang. Say so instead.
    console.error(
      'stdin mode was requested but stdin is a terminal, so there is nothing to read.\n' +
        'Pipe a file list in, or drop the flag to compute it from the working tree:\n' +
        '  git diff --name-only origin/main...HEAD | CHANGELOG_STDIN=1 npm run changelog:check\n' +
        '  npm run changelog:check'
    );
    process.exit(2);
  }
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
      'Could not determine changed files: reading the working tree failed.\n' +
        'Pipe a file list in instead:\n' +
        '  git diff --name-only origin/main...HEAD | CHANGELOG_STDIN=1 npm run changelog:check'
    );
    process.exit(2);
  }
};

// Env var first; `--stdin` stays supported for anyone whose npm forwards it.
const useStdin =
  process.env.CHANGELOG_STDIN === '1' ||
  process.argv.slice(2).includes('--stdin');
const raw = (useStdin ? readStdin() : '').trim() || readGitChanges();
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
