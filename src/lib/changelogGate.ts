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

// ---------------------------------------------------------------------------
// Preservation: an entry that reached `[Unreleased]` must not silently leave it
// ---------------------------------------------------------------------------
//
// The gate above answers "did this PR touch CHANGELOG.md?". That is not the
// same question as "did this PR keep what was already there", and the gap is
// not hypothetical: on #458 a branch updated via GitHub's "Update branch"
// button carried a merge commit that dropped #456's `[Unreleased]` bullet
// outright. The PR touched CHANGELOG.md — it added its own entry — so the gate
// passed while an unrelated PR's entry was deleted. The `release` job publishes
// `[Unreleased]` verbatim as the GitHub Release notes, so a bullet lost here is
// lost from the release record permanently, and nothing downstream notices.
//
// `merge=union` on CHANGELOG.md (#467, .gitattributes) makes accidental loss
// much harder, because a conflicting region resolves by keeping both sides
// rather than by picking one. It does not close the hole: union merge governs
// how a *conflict* resolves, and a deletion that does not conflict is simply a
// deletion. Nor does it help when the loss arrives via a merge commit's tree
// rather than a textual conflict.
//
// The invariant is deliberately weaker than "[Unreleased] is append-only":
//
//   every entry in the BASE's `[Unreleased]` still appears SOMEWHERE in the
//   head's CHANGELOG.md.
//
// "Somewhere in the file", not "still under [Unreleased]", is what makes a
// release cut pass without an exemption: cutting v0.9.0 renames `[Unreleased]`
// to `## [0.9.0]` and opens a fresh empty `[Unreleased]`, so every bullet moves
// section while staying in the file. Tidying the duplicate `### Added` /
// `### Changed` headings that `merge=union` accumulates passes for the same
// reason. Only actual disappearance fails.

/** One top-level bullet from an `[Unreleased]` section. */
export interface UnreleasedEntry {
  /**
   * Stable identity for the bullet. Entries here are written `- **Lead.** …`
   * without exception, and the bold lead is the part that names the change, so
   * it is what identity keys on: rewording a bullet's body is ordinary editing
   * and must not trip the gate, while removing the bullet always does.
   *
   * Normalised — lowercased, whitespace collapsed — so that reflowing a long
   * bullet across different line breaks is not mistaken for deleting it.
   */
  key: string;
  /** The bullet's opening, trimmed for a legible failure message. */
  excerpt: string;
}

export interface PreservationResult {
  /** Base entries with no counterpart in the head file. Empty ⇒ nothing lost. */
  removed: UnreleasedEntry[];
  /** How many entries were checked; 0 ⇒ the base had nothing to protect. */
  checked: number;
  failed: boolean;
}

/**
 * Collapse to a form that survives reflowing, re-indenting and case changes,
 * so only a genuine disappearance registers as one.
 */
const normalise = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The top-level bullets under `## [Unreleased]`.
 *
 * `### Added` / `### Changed` subheadings are stepped over rather than parsed:
 * which subheading a bullet sits under is exactly the thing allowed to change
 * (union merge duplicates them, and a tidy-up merges them back), so grouping is
 * not part of the identity. Nested list items — anything indented — are skipped
 * too; they belong to the bullet above and move with it.
 */
export function extractUnreleasedEntries(changelog: string): UnreleasedEntry[] {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => /^## \[Unreleased\]/i.test(line));
  if (start === -1) return [];

  const entries: UnreleasedEntry[] = [];
  for (const line of lines.slice(start + 1)) {
    // Any other `## ` heading ends the section — the next release, typically.
    if (/^## /.test(line)) break;
    if (!/^[-*] /.test(line)) continue;

    const bold = /^[-*] \*\*(.+?)\*\*/.exec(line);
    // Falling back to a prefix of the whole bullet keeps an unconventional
    // entry protected rather than silently unprotected. 80 characters is enough
    // to identify a bullet and short enough that editing its tail is still free.
    const identity = bold ? bold[1] : line.replace(/^[-*] /, '').slice(0, 80);
    entries.push({
      key: normalise(identity),
      excerpt: line.trim().slice(0, 120)
    });
  }
  return entries;
}

/**
 * Did the head keep every `[Unreleased]` entry the base had?
 *
 * Pure, and comparing whole texts rather than a diff: the caller cannot get a
 * `base...head` range in CI (no job sets `fetch-depth`, so the checkout is
 * shallow — the same constraint that makes the file list come from the API),
 * and two file contents are something it can always fetch.
 */
export function checkUnreleasedPreserved(
  baseChangelog: string,
  headChangelog: string
): PreservationResult {
  const entries = extractUnreleasedEntries(baseChangelog);
  // Normalising the head as one string, newlines included, is what lets a
  // bullet that has been reflowed or moved to another section still match.
  const head = normalise(headChangelog);
  const removed = entries.filter((entry) => !head.includes(entry.key));

  return { removed, checked: entries.length, failed: removed.length > 0 };
}
