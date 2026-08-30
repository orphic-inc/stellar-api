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
  CHANGELOG_PATH,
  ENTRY_REQUIRED_PREFIXES
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
