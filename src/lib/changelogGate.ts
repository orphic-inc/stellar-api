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

// ---------------------------------------------------------------------------
// Headings: one `### <type>` per type under `[Unreleased]` (#537)
// ---------------------------------------------------------------------------
//
// The `[Unreleased]` section accumulates duplicate subheadings — nine `### Fixed`
// at the 0.9.1 cut, ten headings for three types again six commits later. Both
// releases were tidied by hand on release day, and nothing measured it in
// between.
//
// #537 attributes this to `merge=union` (#467). MEASURED, IT IS NOT THAT. Every
// duplicate in the 0.9.1→0.9.2 cycle arrived in the authoring commit itself:
// six consecutive commits each touch this file in ONE hunk at the same anchor,
// with no conflict for a merge driver to resolve. The pattern is that a PR
// PREPENDS its own `### Fixed` block to the top of the section instead of
// appending under the heading already there. Union merge is not implicated; the
// convention is.
//
// That matters twice over. It means a per-PR check genuinely sees the defect —
// it is present in the head commit, not conjured at merge time — and it means
// the durable fix is the documented convention in AGENTS.md, of which this is
// the enforcement half.
//
// The misfiling half of #537 is real but has a different mechanism than filed.
// The contract slices it cites were authored under `### Added` and shipped under
// `### Added`; what put eight entries under the wrong heading at 0.9.1 was the
// MANUAL COALESCE of twelve scrambled blocks on release day. Keeping the section
// at one heading per type is what removes that coalesce, and with it the step
// where a human retypes entries by hand.

/**
 * Heading types allowed under `[Unreleased]`.
 *
 * A closed set rather than "count whatever is there", because the `release` job
 * publishes the section verbatim: `### Fixes` is worse than a duplicate, since
 * it reads as correct and ships as a section nobody meant to publish. Open
 * counting cannot see it — a typo appears once.
 *
 * `Removed` earns its place on precedent (0.8.0, 0.5.6). `Internal`,
 * `Migration` and `Stub tracking` do not: each appeared once, before 0.6.0, and
 * none has been used since. Adding a type is a one-line change here, which is
 * the right amount of friction for text that publishes verbatim.
 */
export const UNRELEASED_HEADINGS = [
  'Added',
  'Changed',
  'Fixed',
  'Security',
  'Docs',
  'Removed'
] as const;

/** One `### ` heading found under `[Unreleased]`. */
export interface HeadingOccurrence {
  /** The heading text, `### ` stripped, whitespace trimmed. */
  name: string;
  /** 1-based line number, so a failure message can point at the file. */
  line: number;
}

export interface HeadingRatchetResult {
  /** Types this branch duplicates beyond what the base already did. */
  worsened: {
    name: string;
    baseSurplus: number;
    headSurplus: number;
    lines: number[];
  }[];
  /** Unrecognised heading names this branch introduced. */
  introduced: HeadingOccurrence[];
  /** Every heading in the head's `[Unreleased]`, for the success line. */
  headHeadings: HeadingOccurrence[];
  /**
   * Types appearing more than once in the head, whoever introduced them.
   *
   * Distinct from `worsened`, and the caller needs both: the ratchet passes on
   * inherited surplus, so a run can succeed with this non-empty — and reporting
   * that as "one per type" would announce a property never established.
   */
  surplus: { name: string; count: number }[];
  failed: boolean;
}

/**
 * The `### ` headings under `## [Unreleased]`, in file order.
 *
 * Scoped to that section alone. Released sections are historical — 0.6.0 groups
 * by date (`### 2026-06-23`), 0.5.4 uses `### Migration` — and rewriting them to
 * satisfy a convention adopted afterwards would edit published Release notes to
 * no purpose.
 */
export function extractUnreleasedHeadings(
  changelog: string
): HeadingOccurrence[] {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => /^## \[Unreleased\]/i.test(line));
  if (start === -1) return [];

  const headings: HeadingOccurrence[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    // Any other `## ` heading ends the section — the previous release.
    if (/^## /.test(line)) break;
    const match = /^### +(.+?) *$/.exec(line);
    if (match) headings.push({ name: match[1], line: i + 1 });
  }
  return headings;
}

/** How many times each heading name appears. */
const countByName = (
  headings: readonly HeadingOccurrence[]
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const h of headings) counts.set(h.name, (counts.get(h.name) ?? 0) + 1);
  return counts;
};

/** Occurrences beyond the first, for one name. `0` when it appears once or not at all. */
const surplusOf = (counts: Map<string, number>, name: string): number =>
  Math.max((counts.get(name) ?? 0) - 1, 0);

/**
 * Did this branch make `[Unreleased]`'s headings worse than the base's?
 *
 * A shrink-only ratchet, not an absolute assertion, for the reason every other
 * guard in this repo is one: a branch must never fail for dirt it inherited.
 * The absolute form would fail both open Renovate PRs the moment the section is
 * tidied, for a file neither of them touches.
 *
 * Compared PER TYPE rather than on a total, so that adding a seventh `### Fixed`
 * while dropping a spare `### Changed` still fails — the totals net out, the
 * defect does not.
 *
 * The base is the MERGE BASE in both callers (CI reads
 * `.merge_base_commit.sha`, local runs `git merge-base`), so "the base" means
 * the state this branch actually started from, not a moving `main`.
 */
export function checkUnreleasedHeadings(
  baseChangelog: string,
  headChangelog: string
): HeadingRatchetResult {
  const baseHeadings = extractUnreleasedHeadings(baseChangelog);
  const headHeadings = extractUnreleasedHeadings(headChangelog);
  const baseCounts = countByName(baseHeadings);
  const headCounts = countByName(headHeadings);

  const worsened: HeadingRatchetResult['worsened'] = [];
  for (const [name, count] of headCounts) {
    const headSurplus = Math.max(count - 1, 0);
    const baseSurplus = surplusOf(baseCounts, name);
    if (headSurplus > baseSurplus) {
      worsened.push({
        name,
        baseSurplus,
        headSurplus,
        lines: headHeadings.filter((h) => h.name === name).map((h) => h.line)
      });
    }
  }

  // An unrecognised name the base already carried is inherited, and failing on
  // it would blame the wrong branch — same reasoning as the surplus ratchet.
  const known = new Set<string>(UNRELEASED_HEADINGS);
  const introduced = headHeadings.filter(
    (h) => !known.has(h.name) && !baseCounts.has(h.name)
  );

  return {
    worsened,
    introduced,
    headHeadings,
    surplus: [...headCounts]
      .filter(([, count]) => count > 1)
      .map(([name, count]) => ({ name, count })),
    failed: worsened.length > 0 || introduced.length > 0
  };
}
