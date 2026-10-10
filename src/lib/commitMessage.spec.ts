import { checkCommitMessage, cleanMessage, SUBJECT_MAX } from './commitMessage';

const rules = (raw: string, allowAutosquash = false): string[] =>
  checkCommitMessage(raw, { allowAutosquash }).map((f) => f.rule);

const errors = (raw: string): string[] =>
  checkCommitMessage(raw)
    .filter((f) => f.severity === 'error')
    .map((f) => f.rule);

describe('checkCommitMessage', () => {
  it.each([
    "feat(invites): staff act on a member's whole invite subtree (#639)",
    'fix(seed): the boot seed creates ranks and rules on a fresh install only (#882)',
    'fix(assets,stats): guard every assetStore.ts and statsHistory.ts write (#843, #844)',
    'fix(releases): delete a release with no contributions (#793)',
    'docs(context): the ratio policy disabled state is DOWNLOAD_DISABLED',
    'chore(release): the 0.10.2 cut',
    'chore(deps): update npm non-major'
  ])('passes house-style subject %p', (subject) => {
    expect(rules(`${subject}\n\nWhy it changed.\n`)).toEqual([]);
  });

  it('passes a body, comment lines and everything below the scissors', () => {
    const raw = [
      'fix(auth): the session list marks the current session (#277)',
      '',
      'Body.',
      '# Please enter the commit message',
      '# ------------------------ >8 ------------------------',
      'diff --git a/x b/x'
    ].join('\n');
    expect(rules(raw)).toEqual([]);
  });

  describe('errors', () => {
    it('flags a subject wrapped onto line 2 (8b27cf5)', () => {
      const raw =
        'fix(auth): GET /auth/sessions never sent isCurrent, so the UI could not\n' +
        ' mark the session you were using\n\nBody.';
      expect(errors(raw)).toEqual(['subject-wrapped']);
    });

    it('measures length without the issue suffix', () => {
      const atLimit = `fix(x): ${'a'.repeat(SUBJECT_MAX - 'fix(x): '.length)}`;
      expect(errors(`${atLimit} (#843, #844)`)).toEqual([]);
      expect(errors(`${atLimit}a (#843)`)).toEqual(['subject-too-long']);
    });

    it.each([
      ['initial import', 'type-missing'],
      ['Feat: add retry', 'type-case'],
      ['release: promote develop → main (v0.5.4)', 'type-unknown'],
      ['fix: ', 'empty-subject'],
      ['feat(x): WIP retry', 'wip']
    ])('flags %p as %s', (subject, rule) => {
      expect(errors(subject)).toContain(rule);
    });

    it('flags an empty message', () => {
      expect(errors('# only a comment\n\n')).toEqual(['empty']);
    });

    it('refuses fixup! commits on a pull request but accepts them at commit time', () => {
      expect(errors('fixup! feat(x): y')).toEqual(['autosquash-pending']);
      expect(rules('fixup! feat(x): y', true)).toEqual([]);
    });

    it('leaves subjects git writes itself alone', () => {
      expect(rules("Merge branch 'main' into feature")).toEqual([]);
      expect(rules('Revert "feat(x): y"\n\nThis reverts commit abc.')).toEqual(
        []
      );
    });
  });

  describe('warnings', () => {
    it.each([
      ['fix: added retry', 'past-tense'],
      ['fix: adds retry', 'third-person'],
      ['fix: adding retry', 'gerund'],
      ['fix: add retry.', 'subject-period'],
      ['fix():  add retry', 'empty-scope']
    ])('warns on %p as %s', (subject, rule) => {
      const findings = checkCommitMessage(subject);
      expect(findings.map((f) => f.rule)).toContain(rule);
      expect(findings.every((f) => f.severity === 'warning')).toBe(true);
    });

    it('wants a footer on a subject marked breaking (1315669)', () => {
      expect(
        rules(
          'feat(settings)!: privacy is five flags, not a level (#586)\n\n' +
            'Breaking change: `UserSettings.paranoia` is removed.'
        )
      ).toEqual(['breaking-footer']);
      expect(
        rules(
          'feat(settings)!: privacy is five flags, not a level (#586)\n\n' +
            'BREAKING CHANGE: read the five show* flags instead.'
        )
      ).toEqual([]);
    });

    it('wants `!` on a body that describes a breaking change (38018f5)', () => {
      expect(
        rules(
          "fix(comments): comment threads follow their page's access (#697)\n\n" +
            '- GET /comments requires context and pageId (breaking)'
        )
      ).toEqual(['breaking-unmarked']);
    });
  });
});

describe('cleanMessage', () => {
  it('drops CRLFs, a BOM and surrounding blank lines', () => {
    expect(cleanMessage('\ufeff\r\nfix: x\r\n\r\nbody\r\n\r\n')).toEqual([
      'fix: x',
      '',
      'body'
    ]);
  });
});
