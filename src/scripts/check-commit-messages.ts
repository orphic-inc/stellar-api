// CLI wrapper for the commit message gate. Gathers messages and feeds them to
// the pure checker in lib/commitMessage.ts, mirroring check-changelog.ts.
//
// Three callers, and each names its input with an environment variable rather
// than argv, because argv does not survive npm reliably (see check-changelog.ts):
//
//   - The commit-msg hook sets `COMMIT_MSG_FILE` to git's message file. One
//     message, and `fixup!`/`squash!` commits pass: they are a normal step
//     towards `git rebase --autosquash`.
//   - CI sets `COMMIT_MESSAGES_FILE` to the pull request's commits, one JSON
//     object `{ sha, message }` per line, from the GitHub API. Not git: no job
//     in publish.yml sets `fetch-depth`, so the runner's checkout is shallow.
//   - Locally, with neither set, it checks `origin/main..HEAD`, so an author
//     can check a branch before pushing.
//
// Nothing here reads stdin; check-changelog.ts explains why that matters.
//
// Run:
//   npm run commits:check
//   COMMIT_MSG_FILE=.git/COMMIT_EDITMSG npm run commits:check --silent
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  checkCommitMessage,
  cleanMessage,
  CommitFinding
} from '../lib/commitMessage';

const root = resolve(__dirname, '../..');

interface Commit {
  sha: string;
  message: string;
}

const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};

const readFile = (path: string, variable: string): string => {
  try {
    return readFileSync(resolve(root, path), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
    return fail(
      `${variable} is set to ${path} but reading it failed (${code}).`
    );
  }
};

/** CI: one `{ sha, message }` JSON object per line. */
const parseCommitLines = (text: string): Commit[] =>
  text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Commit);

/** Local: every commit this branch would bring to main, oldest first. */
const readBranchCommits = (): Commit[] => {
  let out = '';
  try {
    out = execFileSync(
      'git',
      ['log', '--reverse', '-z', '--format=%H%x00%B', 'origin/main..HEAD'],
      { cwd: root, encoding: 'utf8' }
    );
  } catch {
    fail(
      'Could not read origin/main..HEAD. Fetch first: git fetch origin main'
    );
  }
  const fields = out.split('\0');
  const commits: Commit[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    commits.push({ sha: fields[i].trim(), message: fields[i + 1] });
  }
  return commits;
};

const report = (label: string, findings: CommitFinding[]): void => {
  for (const f of findings) {
    const line = `  ${f.severity === 'error' ? '✗' : '!'} ${f.rule}: ${f.message}`;
    if (f.severity === 'error') console.error(line);
    else console.warn(line);
  }
  if (findings.length > 0) console.error(`    in ${label}\n`);
};

const hookFile = process.env.COMMIT_MSG_FILE;
const ciFile = process.env.COMMIT_MESSAGES_FILE;

const commits: Commit[] = hookFile
  ? [{ sha: '', message: readFile(hookFile, 'COMMIT_MSG_FILE') }]
  : ciFile
    ? parseCommitLines(readFile(ciFile, 'COMMIT_MESSAGES_FILE'))
    : readBranchCommits();

let errors = 0;
for (const commit of commits) {
  const findings = checkCommitMessage(commit.message, {
    allowAutosquash: Boolean(hookFile)
  });
  const subject = cleanMessage(commit.message)[0] ?? '';
  report(hookFile ? subject : `${commit.sha.slice(0, 7)} ${subject}`, findings);
  errors += findings.filter((f) => f.severity === 'error').length;
}

if (errors > 0) {
  console.error(
    `${errors} commit message error(s). A merged message is permanent, so fix it\n` +
      'before it lands: `git commit --amend` for the last commit, or reword older\n' +
      'ones with an interactive rebase onto origin/main. House style is in\n' +
      "AGENTS.md under 'Commit workflow'."
  );
  process.exit(1);
}

if (!hookFile) {
  console.log(`${commits.length} commit message(s) meet the house style.`);
}
