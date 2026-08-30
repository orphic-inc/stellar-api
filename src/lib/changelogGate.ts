// Pure changelog gate (#386). Given the files a pull request changed, decide
// whether it owes a CHANGELOG entry. No I/O — the CLI wrapper
// (src/scripts/check-changelog.ts) gathers the real file list and feeds it in,
// same split as lib/versionConsistency.ts (#79).
//
// Why a per-PR file check rather than reconciling `[Unreleased]` against the
// commit range: entries are not 1:1 with commits. At the time this landed,
// `[Unreleased]` held 17 bullets for 13 commits — one commit produced two
// bullets, one bullet covered four commits — so there is no sound threshold for
// "materially behind". And entries get written in batches well after the code
// (the SSRF and nodemailer bullets were both added days later, by an unrelated
// docs commit). That lag *is* the rot this gate exists to stop, so it has to
// fire at authorship, while the author still has the context to write the entry.

/** The changelog itself — the file whose presence satisfies the gate. */
export const CHANGELOG_PATH = 'CHANGELOG.md';

/**
 * Path prefixes whose modification obliges a CHANGELOG entry.
 *
 * Deliberately short, explicit, and easy to amend rather than a clever pattern.
 * `.github/workflows` earns its place: #386 counts "both CI changes" among the
 * twenty commits that went unrecorded between v0.8.1 and the backfill, so
 * workflow edits are exactly the kind of change that slips through unnoticed.
 *
 * Everything absent from this list — `docs/`, other Markdown, tooling config —
 * is exempt, on the grounds that it does not ship behaviour to a consumer.
 */
export const ENTRY_REQUIRED_PREFIXES = [
  'src/',
  'prisma/',
  '.github/workflows/'
] as const;

export interface ChangelogGateResult {
  /** Changed paths that oblige an entry. Empty ⇒ the gate never engaged. */
  triggeringPaths: string[];
  /** Whether CHANGELOG.md is among the changed files. */
  changelogTouched: boolean;
  /** The verdict: owed an entry and did not get one. */
  failed: boolean;
}

/** Does this path oblige an entry? */
const requiresEntry = (path: string): boolean =>
  ENTRY_REQUIRED_PREFIXES.some((prefix) => path.startsWith(prefix));

/**
 * Decide whether a set of changed files owes a CHANGELOG entry.
 *
 * Passing an empty list is a pass, not a failure: a PR that changed nothing the
 * gate cares about owes nothing. The caller distinguishes "gate not engaged"
 * from "gate satisfied" via `triggeringPaths`.
 */
export function checkChangelogGate(
  changedFiles: readonly string[]
): ChangelogGateResult {
  // Normalise: the GitHub API and `git diff --name-only` both emit
  // repo-relative POSIX paths, but tolerate stray whitespace and blank lines
  // from a pipe.
  const files = changedFiles.map((f) => f.trim()).filter((f) => f.length > 0);

  const triggeringPaths = files.filter(requiresEntry);
  const changelogTouched = files.includes(CHANGELOG_PATH);

  return {
    triggeringPaths,
    changelogTouched,
    failed: triggeringPaths.length > 0 && !changelogTouched
  };
}
