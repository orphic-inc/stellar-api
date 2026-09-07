/**
 * The changelog gate (#386).
 *
 * The two historical cases at the bottom are the point of this file: real file
 * lists from real commits, one that needed hand-backfilling into `[Unreleased]`
 * and one that recorded itself. A rule that cannot separate those two is not
 * worth running in CI.
 */
import {
  checkChangelogGate,
  checkUnreleasedHeadings,
  checkUnreleasedPreserved,
  extractUnreleasedEntries,
  extractUnreleasedHeadings,
  CHANGELOG_PATH,
  ENTRY_REQUIRED_PREFIXES,
  UNRELEASED_HEADINGS
} from './changelogGate';

describe('checkChangelogGate', () => {
  it('fails a source change that does not touch the changelog', () => {
    const result = checkChangelogGate(['src/modules/reports.ts']);
    expect(result.failed).toBe(true);
    expect(result.triggeringPaths).toEqual(['src/modules/reports.ts']);
    expect(result.changelogTouched).toBe(false);
  });

  it('passes the same change once the changelog moves with it', () => {
    const result = checkChangelogGate([
      'src/modules/reports.ts',
      CHANGELOG_PATH
    ]);
    expect(result.failed).toBe(false);
    expect(result.changelogTouched).toBe(true);
    // Still reports what obliged the entry — the gate engaged and was satisfied.
    expect(result.triggeringPaths).toEqual(['src/modules/reports.ts']);
  });

  it('never engages for docs-only changes', () => {
    const result = checkChangelogGate([
      'docs/adr/0034-eslint-9-flat-config.md',
      'README.md'
    ]);
    expect(result.failed).toBe(false);
    expect(result.triggeringPaths).toEqual([]);
  });

  it('engages for every path prefix it claims to cover', () => {
    // Guards the list itself: an entry added to ENTRY_REQUIRED_PREFIXES without
    // working would otherwise sit there looking enforced.
    for (const prefix of ENTRY_REQUIRED_PREFIXES) {
      const result = checkChangelogGate([`${prefix}some-file.ts`]);
      expect(result.failed).toBe(true);
    }
  });

  it('engages for migrations and workflow edits, not just src', () => {
    expect(
      checkChangelogGate(['prisma/migrations/20260101000000_x/migration.sql'])
        .failed
    ).toBe(true);
    // #386 counts "both CI changes" among the commits that went unrecorded.
    expect(checkChangelogGate(['.github/workflows/publish.yml']).failed).toBe(
      true
    );
  });

  it('is a pass when nothing changed', () => {
    // A PR that touched nothing the gate cares about owes nothing.
    expect(checkChangelogGate([]).failed).toBe(false);
  });

  it('tolerates blank lines and stray whitespace from a pipe', () => {
    const result = checkChangelogGate([
      '  src/modules/reports.ts  ',
      '',
      '   ',
      `  ${CHANGELOG_PATH}`
    ]);
    expect(result.failed).toBe(false);
    expect(result.triggeringPaths).toEqual(['src/modules/reports.ts']);
  });

  it('does not mistake a path that merely contains a prefix', () => {
    // Prefix match is anchored: a vendored copy is not this repo's src.
    const result = checkChangelogGate(['vendor/src/thing.ts']);
    expect(result.failed).toBe(false);
    expect(result.triggeringPaths).toEqual([]);
  });

  describe('against real history', () => {
    it('flags baf66bc — the SSRF guard, backfilled by hand days later', () => {
      const result = checkChangelogGate([
        'src/lib/ssrfGuard.spec.ts',
        'src/lib/ssrfGuard.ts',
        'src/modules/linkHealth.spec.ts',
        'src/modules/linkHealth.ts'
      ]);
      expect(result.failed).toBe(true);
    });

    it('passes cb9cc79 — the e2e fixture, which recorded itself', () => {
      const result = checkChangelogGate([
        'CHANGELOG.md',
        'src/integration/e2eFixtures.integration.ts',
        'src/modules/e2eFixtures.ts',
        'src/scripts/seed-e2e-users.ts'
      ]);
      expect(result.failed).toBe(false);
    });
  });
});

/**
 * Entry preservation (the #458 hole).
 *
 * The cases that must PASS carry as much weight as the one that must fail: a
 * check that blocks the release cut, or a heading tidy-up, would be turned off
 * within a week and the hole would reopen.
 */
describe('checkUnreleasedPreserved', () => {
  const base = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '- **Authors can edit and withdraw their stylesheets** — the authored-stylesheet surface had no update path.',
    '',
    '### Fixed',
    '',
    '- **The stylesheet registry can no longer be left with no default** — `getDefaultStylesheetName` ended `?? null`.',
    '',
    '## [0.8.3] — 2026-08-30',
    '',
    '- **Something already released** — untouched by any of this.',
    ''
  ].join('\n');

  it('finds both entries in the base section', () => {
    const entries = extractUnreleasedEntries(base);
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toContain('authors can edit and withdraw');
  });

  it('stops at the next release heading', () => {
    const keys = extractUnreleasedEntries(base).map((e) => e.key);
    expect(keys.some((k) => k.includes('already released'))).toBe(false);
  });

  it("fails when a branch drops another PR's entry — the #458 shape", () => {
    // The branch added its own bullet and deleted someone else's, which is
    // exactly what passes checkChangelogGate.
    const head = base.replace(
      '- **Authors can edit and withdraw their stylesheets** — the authored-stylesheet surface had no update path.',
      '- **Avatars can be self-hosted in the asset store** — a different PR entirely.'
    );
    const result = checkUnreleasedPreserved(base, head);
    expect(result.failed).toBe(true);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].excerpt).toContain('edit and withdraw');
  });

  it('passes a release cut, where every entry moves to a dated section', () => {
    // What cutting v0.9.0 does: the section is renamed and a fresh empty
    // [Unreleased] opens above it. Every bullet is still in the file, which is
    // precisely why the invariant is "somewhere in the file" and not "still
    // under [Unreleased]" — the stricter rule would block every release.
    const head = base.replace(
      '## [Unreleased]',
      '## [Unreleased]\n\n## [0.9.0] — 2026-09-01'
    );
    const result = checkUnreleasedPreserved(base, head);
    expect(result.failed).toBe(false);
    expect(result.checked).toBe(2);
    expect(extractUnreleasedEntries(head)).toHaveLength(0);
  });

  it('passes a heading tidy-up that merges union-merge duplicates', () => {
    // Same bullets, one `### Added` block instead of two scattered sections.
    const head = [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '- **Authors can edit and withdraw their stylesheets** — the authored-stylesheet surface had no update path.',
      '- **The stylesheet registry can no longer be left with no default** — `getDefaultStylesheetName` ended `?? null`.',
      ''
    ].join('\n');
    expect(checkUnreleasedPreserved(base, head).failed).toBe(false);
  });

  it('passes when a bullet is reworded below its bold lead', () => {
    const head = base.replace(
      'the authored-stylesheet surface had no update path.',
      'the surface had no update or delete path, so a published sheet was permanent.'
    );
    expect(checkUnreleasedPreserved(base, head).failed).toBe(false);
  });

  it('passes when a bullet is reflowed across different line breaks', () => {
    const head = base.replace(
      '- **Authors can edit and withdraw their stylesheets** — the authored-stylesheet surface had no update path.',
      '- **Authors can edit and withdraw their\n  stylesheets** — the authored-stylesheet surface had no update path.'
    );
    expect(checkUnreleasedPreserved(base, head).failed).toBe(false);
  });

  it('protects an entry with no bold lead by falling back to its text', () => {
    const plain =
      '## [Unreleased]\n\n- a plain bullet with no bold lead at all\n';
    expect(extractUnreleasedEntries(plain)).toHaveLength(1);
    expect(checkUnreleasedPreserved(plain, '## [Unreleased]\n').failed).toBe(
      true
    );
  });

  it('has nothing to protect when the base section is empty', () => {
    const empty = '# Changelog\n\n## [Unreleased]\n\n## [0.8.3] — 2026-08-30\n';
    const result = checkUnreleasedPreserved(empty, '# Changelog\n');
    expect(result.checked).toBe(0);
    expect(result.failed).toBe(false);
  });
});

/**
 * Heading duplication under `[Unreleased]` (#537).
 *
 * The cases that matter are the last two: the shape six consecutive commits
 * actually produced between 0.9.1 and 0.9.2, and the inherited-surplus case
 * that must NOT fail, because failing it would block two Renovate PRs over a
 * file neither of them touches.
 */
describe('checkUnreleasedHeadings', () => {
  /** A changelog whose `[Unreleased]` holds the given headings, in order. */
  const withHeadings = (...headings: string[]): string =>
    [
      '# Changelog',
      '',
      '## [Unreleased]',
      ...headings.flatMap((h) => [
        '',
        `### ${h}`,
        '',
        `- **An entry under ${h}.**`
      ]),
      '',
      '## [0.9.1] — 2026-09-06',
      '',
      '### Fixed',
      '',
      '- **Something already released.**',
      ''
    ].join('\n');

  it('reads the headings under [Unreleased] and stops at the previous release', () => {
    const headings = extractUnreleasedHeadings(withHeadings('Added', 'Fixed'));
    expect(headings.map((h) => h.name)).toEqual(['Added', 'Fixed']);
  });

  it('returns nothing when there is no [Unreleased] section at all', () => {
    // The shape immediately after a release cut renames it. Nothing to check,
    // and emphatically not a failure.
    const cut = [
      '# Changelog',
      '',
      '## [0.9.1] — 2026-09-06',
      '',
      '### Fixed',
      ''
    ].join('\n');
    expect(extractUnreleasedHeadings(cut)).toEqual([]);
    expect(checkUnreleasedHeadings(cut, cut).failed).toBe(false);
  });

  it('passes a branch that appends under the heading already there', () => {
    // The convention the gate exists to enforce: same headings before and after.
    const base = withHeadings('Added', 'Fixed');
    const head = withHeadings('Added', 'Fixed');
    expect(checkUnreleasedHeadings(base, head).failed).toBe(false);
  });

  it('fails a branch that opens a second heading of a type — the #537 shape', () => {
    const base = withHeadings('Fixed');
    const head = withHeadings('Fixed', 'Fixed');
    const result = checkUnreleasedHeadings(base, head);
    expect(result.failed).toBe(true);
    expect(result.worsened).toHaveLength(1);
    expect(result.worsened[0]).toMatchObject({
      name: 'Fixed',
      baseSurplus: 0,
      headSurplus: 1
    });
    // The lines are what makes the failure actionable rather than a scolding.
    expect(result.worsened[0].lines).toHaveLength(2);
  });

  it('passes a branch that coalesces — the ratchet only ever shrinks', () => {
    const base = withHeadings('Fixed', 'Fixed', 'Changed', 'Fixed');
    const head = withHeadings('Changed', 'Fixed');
    expect(checkUnreleasedHeadings(base, head).failed).toBe(false);
  });

  it('passes surplus it inherited from the base rather than introduced', () => {
    // A branch that never touches CHANGELOG.md still carries whatever main had.
    // Blaming it is how an absolute check would block both open Renovate PRs.
    const dirty = withHeadings('Fixed', 'Fixed', 'Changed');
    expect(checkUnreleasedHeadings(dirty, dirty).failed).toBe(false);
  });

  it('compares per type, so a swap that nets to zero still fails', () => {
    // Total surplus is 1 on both sides; the Fixed duplication is still new.
    const base = withHeadings('Changed', 'Changed', 'Fixed');
    const head = withHeadings('Changed', 'Fixed', 'Fixed');
    const result = checkUnreleasedHeadings(base, head);
    expect(result.failed).toBe(true);
    expect(result.worsened.map((w) => w.name)).toEqual(['Fixed']);
  });

  it('fails a typo’d heading, which open counting could never see', () => {
    // `### Fixes` appears once, so a duplicate rule alone passes it — and the
    // release job would publish a section nobody meant to write.
    const result = checkUnreleasedHeadings(
      withHeadings('Fixed'),
      withHeadings('Fixed', 'Fixes')
    );
    expect(result.failed).toBe(true);
    expect(result.introduced.map((h) => h.name)).toEqual(['Fixes']);
  });

  it('passes an unrecognised heading the base already carried', () => {
    const inherited = withHeadings('Internal');
    expect(checkUnreleasedHeadings(inherited, inherited).failed).toBe(false);
  });

  it('accepts every name in the published vocabulary', () => {
    const all = withHeadings(...UNRELEASED_HEADINGS);
    expect(checkUnreleasedHeadings(all, all).failed).toBe(false);
  });

  describe('against real history', () => {
    it('fails the 0.9.1→0.9.2 cycle as it stood, against a coalesced base', () => {
      // The section on main at 3b1ac92: ten headings for three types, one
      // added by each of six consecutive commits. Measured, none of it came
      // from `merge=union` — every duplicate is in its authoring commit.
      const asItStood = withHeadings(
        'Fixed',
        'Fixed',
        'Fixed',
        'Changed',
        'Fixed',
        'Fixed',
        'Changed',
        'Fixed',
        'Added',
        'Changed'
      );
      const coalesced = withHeadings('Added', 'Changed', 'Fixed');

      const result = checkUnreleasedHeadings(coalesced, asItStood);
      expect(result.failed).toBe(true);
      expect(result.worsened.map((w) => [w.name, w.headSurplus + 1])).toEqual([
        ['Fixed', 6],
        ['Changed', 3]
      ]);

      // And the direction this PR actually travels is a pass.
      expect(checkUnreleasedHeadings(asItStood, coalesced).failed).toBe(false);
    });
  });
});
