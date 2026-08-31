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
// The switch is not ceremony. This script used to read fd 0 unconditionally and
// fall back when it came back empty, which cannot work: `readFileSync(0)` blocks
// until EOF, and "nothing is on stdin" is indistinguishable from "the writer has
// not written yet" until the writer closes. A caller that inherits an open stdin
// it never writes to or closes — an editor task runner, a CI shell, an agent
// harness — hung forever. One such invocation sat blocked for fifteen hours.
//
// READING fd 0 IS ITS OWN HAZARD, SEPARATE FROM DECIDING TO READ IT. This file
// has now broken twice, in two unrelated ways, and both survived a full local
// verification:
//
//   1. argv does not survive npm reliably. `npm run x --silent -- --stdin`
//      forwards the flag under npm 10 and drops it under npm 11, and CI runs
//      Node 24 (npm 11) while a dev box may be on Node 22 (npm 10). Hence the
//      env var below: it is set by the shell before npm, and parsed by no one.
//
//   2. Touching `process.stdin` poisons the very read it was guarding. The
//      getter CONSTRUCTS the stream and puts fd 0 into non-blocking mode, after
//      which `readFileSync(0)` throws EAGAIN whenever the pipe has no data
//      buffered yet. The old TTY guard read `process.stdin.isTTY` and did
//      exactly this. Locally it passed, because `printf | …` fills the pipe
//      before the read and wins the race; on CI `gh api --paginate` goes to the
//      network first and loses it. `tty.isatty(0)` answers the same question as
//      a bare syscall, without creating a stream. Do not reintroduce
//      `process.stdin` here in any form.
//
// The corollary, learned from (2): a failed read must never be reinterpreted as
// a different input mode. It used to be — the EAGAIN was swallowed to '' and an
// empty result fell back to git — so the gate reported a confident verdict about
// the working tree while the caller was asking about a piped list. On CI that
// surfaced as an unresolvable `origin/main...HEAD` on the shallow checkout; run
// locally the same fallback simply *passed*, silently measuring the wrong files.
// Stdin mode now means stdin: it reads the pipe or it exits non-zero.
//
// Run:
//   npm run changelog:check                                    # local, computed
//   git diff --name-only origin/main...HEAD \
//     | CHANGELOG_STDIN=1 npm run changelog:check
//   printf 'src/x.ts\n' | CHANGELOG_STDIN=1 npm run changelog:check --silent
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isatty } from 'tty';
import {
  checkChangelogGate,
  CHANGELOG_PATH,
  ENTRY_REQUIRED_PREFIXES
} from '../lib/changelogGate';

const root = resolve(__dirname, '../..');

/**
 * Everything on stdin, read to EOF. Only ever called in stdin mode, because
 * this call blocks until the writer closes and there is no sound way to ask
 * "is anything coming?" first.
 *
 * Both the TTY probe and the failure path are load-bearing; see the header.
 */
const readStdin = (): string => {
  // `isatty(0)`, never `process.stdin.isTTY` — the latter makes fd 0
  // non-blocking and breaks the read below.
  if (isatty(0)) {
    // Stdin mode from a terminal is a caller mistake: the read would block on
    // keyboard input until Ctrl-D and look like a hang. Say so instead.
    console.error(
      'stdin mode was requested but stdin is a terminal, so there is nothing to read.\n' +
        'Pipe a file list in, or drop the switch to compute it from the working tree:\n' +
        '  git diff --name-only origin/main...HEAD | CHANGELOG_STDIN=1 npm run changelog:check\n' +
        '  npm run changelog:check'
    );
    process.exit(2);
  }
  try {
    return readFileSync(0, 'utf8');
  } catch (err) {
    // Deliberately fatal. Falling back to the working tree here is what hid the
    // EAGAIN bug: the gate answered a question nobody asked, and passed.
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
    console.error(
      `stdin mode was requested but reading stdin failed (${code}).\n` +
        'Not falling back to the working tree: the caller asked about a piped\n' +
        'file list, and answering about different files would be worse than failing.'
    );
    process.exit(2);
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
// No `||` fallback between the two: the caller states its input path, and a
// stated path is honoured or the run fails. An empty piped list is a legitimate
// pass (checkChangelogGate([]) does not fail), not a cue to go read git.
const raw = useStdin ? readStdin() : readGitChanges();
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
