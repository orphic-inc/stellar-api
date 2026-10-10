// Pure commit message gate. Given one commit message, report where it departs
// from the house style `git log origin/main` has used since the repo moved to
// Conventional Commits. No I/O — the CLI wrapper
// (src/scripts/check-commit-messages.ts) gathers the messages, from the
// commit-msg hook's file or a pull request's commits, same split as
// lib/changelogGate.ts.
//
// Only errors fail. A message that merges is permanent: rewriting it means
// force-pushing `main`, moving release tags and stranding stellar-compose's
// submodule pin. So errors are limited to what the log shows going wrong in
// practice: a subject wrapped onto line 2, one past the length limit, or no
// type at all. Mood and breaking-change markers are warnings, because the
// checker sees only text, not the diff.

/** Subject length limit, not counting the trailing issue suffix. */
export const SUBJECT_MAX = 100;

export const COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert'
] as const;

export type Severity = 'error' | 'warning';

export interface CommitFinding {
  severity: Severity;
  rule: string;
  message: string;
}

const CONVENTIONAL =
  /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:(?<space>\s*)(?<subject>.*)$/;
const LOOSE_TYPE = /^(?<type>[A-Za-z]+)(?:\([^)]*\))?!?:\s*\S/;
// (#639) or (#843, #844). Not counted toward the length limit.
const ISSUE_SUFFIX = /\s*\(#\d+(?:, #\d+)*\)$/;
// Subjects git writes itself. Merge commits are refused by the repo anyway.
const GIT_GENERATED =
  /^(Merge (branch|pull request|remote-tracking branch|tag) |Merge [0-9a-f]{7,} into |Revert ")/;
const AUTOSQUASH = /^(fixup|squash|amend)! /;
const SCISSORS = '# ------------------------ >8 ------------------------';

/**
 * Strip what git strips before storing a message: comment lines, everything
 * below `git commit -v`'s scissors, and surrounding blank lines.
 */
export function cleanMessage(raw: string): string[] {
  const lines = raw
    .replace(/^\ufeff/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const scissors = lines.indexOf(SCISSORS);
  const kept = (scissors === -1 ? lines : lines.slice(0, scissors)).filter(
    (line) => !line.startsWith('#')
  );
  while (kept.length > 0 && kept[0].trim() === '') kept.shift();
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  return kept;
}

const error = (rule: string, message: string): CommitFinding => ({
  severity: 'error',
  rule,
  message
});

const warning = (rule: string, message: string): CommitFinding => ({
  severity: 'warning',
  rule,
  message
});

const isKnownType = (type: string): boolean =>
  (COMMIT_TYPES as readonly string[]).includes(type);

/** A subject that does not parse as `type(scope)!: description`, diagnosed. */
function diagnoseType(subject: string): CommitFinding {
  const loose = LOOSE_TYPE.exec(subject);
  if (!loose?.groups) {
    return error(
      'type-missing',
      'Subject must start with type(scope): description'
    );
  }
  const type = loose.groups.type;
  if (isKnownType(type.toLowerCase())) {
    return error('type-case', `Use lowercase type \`${type.toLowerCase()}:\``);
  }
  return error(
    'type-unknown',
    `Unknown type \`${type}\`; use one of: ${COMMIT_TYPES.join(', ')}`
  );
}

/** Length, punctuation and placeholder checks on the whole subject line. */
function checkSubjectLine(subject: string): CommitFinding[] {
  const findings: CommitFinding[] = [];
  const suffix = ISSUE_SUFFIX.exec(subject);
  const measured = subject.length - (suffix ? suffix[0].length : 0);
  if (measured > SUBJECT_MAX) {
    findings.push(
      error(
        'subject-too-long',
        `Subject is ${measured} characters without the issue suffix (max ${SUBJECT_MAX})`
      )
    );
  }
  if (subject.endsWith('.')) {
    findings.push(warning('subject-period', 'Omit the trailing period'));
  }
  if (/\b(WIP|TODO|TMP)\b/i.test(subject)) {
    findings.push(
      error('wip', 'Subject looks temporary (WIP/TODO/TMP); finish the commit')
    );
  }
  return findings;
}

const MOOD_RULES: ReadonlyArray<[RegExp, string, string]> = [
  [
    /^(fixed|added|updated|removed|changed|deleted)\b/i,
    'past-tense',
    'State the outcome ("x now does y") or use the imperative (fix/add), not past tense'
  ],
  [
    /^(fixes|adds|updates|removes|changes)\b/i,
    'third-person',
    'Give the verb a subject ("the seed creates") or use the imperative (fix/add)'
  ],
  [
    /^(fixing|adding|updating|removing|changing|deleting|refactoring)\b/i,
    'gerund',
    'State the outcome or use the imperative (fix/add), not the -ing form'
  ]
];

/** Checks on the description after `type(scope):`. */
function checkDescription(
  description: string,
  scope: string | undefined,
  space: string
): CommitFinding[] {
  if (description === '') {
    return [error('empty-subject', 'Nothing follows the type')];
  }
  const findings: CommitFinding[] = [];
  if (scope !== undefined && scope.trim() === '') {
    findings.push(warning('empty-scope', 'Scope parentheses are empty'));
  }
  if (space !== ' ') {
    findings.push(
      warning('colon-space', 'Use exactly one space after the colon')
    );
  }
  for (const [pattern, rule, message] of MOOD_RULES) {
    if (pattern.test(description)) findings.push(warning(rule, message));
  }
  return findings;
}

const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/;
const BREAKING_PROSE = /^breaking[ -]change\b|\(breaking\)/i;

/**
 * A contract change must say so twice: `!` in the subject for anyone scanning
 * the log, and a `BREAKING CHANGE:` footer saying what consumers must do.
 */
function checkBreaking(marked: boolean, body: string[]): CommitFinding[] {
  const footer = body.some((line) => BREAKING_FOOTER.test(line));
  const prose = body.some((line) => BREAKING_PROSE.test(line.trim()));
  if (marked && !footer) {
    return [
      warning(
        'breaking-footer',
        'Marked breaking (!): add a BREAKING CHANGE: footer saying what consumers must do'
      )
    ];
  }
  if (!marked && (footer || prose)) {
    return [
      warning(
        'breaking-unmarked',
        'The body describes a breaking change but the subject has no `!` before the colon'
      )
    ];
  }
  return [];
}

export interface CheckOptions {
  /**
   * Accept `fixup!`/`squash!` commits. True at commit time, where they are a
   * normal step towards `git rebase --autosquash`; false on a pull request,
   * where one left in would merge as written.
   */
  allowAutosquash?: boolean;
}

/**
 * Subjects decided before any style rule applies: those git writes itself,
 * which are left alone, and autosquash commits. `undefined` means lint it.
 */
function precheck(
  subject: string,
  options: CheckOptions
): CommitFinding[] | undefined {
  if (GIT_GENERATED.test(subject)) return [];
  if (!AUTOSQUASH.test(subject)) return undefined;
  if (options.allowAutosquash) return [];
  return [
    error(
      'autosquash-pending',
      'fixup!/squash! commit: run `git rebase --autosquash origin/main` before merging'
    )
  ];
}

/** Check one commit message. An empty list means it meets the house style. */
export function checkCommitMessage(
  raw: string,
  options: CheckOptions = {}
): CommitFinding[] {
  const lines = cleanMessage(raw);
  if (lines.length === 0) return [error('empty', 'The message is empty')];

  const subject = lines[0].trim();
  const body = lines.slice(1);
  const decided = precheck(subject, options);
  if (decided) return decided;

  const findings: CommitFinding[] = [];
  const parsed = CONVENTIONAL.exec(subject)?.groups;
  if (parsed && isKnownType(parsed.type)) {
    findings.push(
      ...checkDescription(parsed.subject.trim(), parsed.scope, parsed.space)
    );
  } else {
    findings.push(diagnoseType(subject));
  }
  findings.push(...checkSubjectLine(subject));
  if (body.length > 0 && body[0].trim() !== '') {
    findings.push(
      error(
        'subject-wrapped',
        'Line 2 is not blank: keep the subject on one line, then a blank line before the body'
      )
    );
  }
  findings.push(...checkBreaking(parsed?.breaking === '!', body));
  return findings;
}
