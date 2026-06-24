/**
 * EAC scorer — branch coverage with synthetic minimal logs.
 *
 * `scoreEac` receives the log lines AFTER the version header has been shifted off
 * (as checkLog does). The first non-"EAC extraction logfile" line is consumed as
 * the artist/album continuation line, mirroring the legacy parser.
 */
import { scoreEac } from './eac';

/** A minimal, verified-perfect secure EAC rip (one track, AccurateRip-confirmed). */
function perfectEac(): string[] {
  return [
    'EAC extraction logfile from 1. January 2020, 0:00',
    'Artist / Album', // consumed as the AA continuation line
    'Used drive : Some Drive',
    'Read mode : Secure',
    'Defeat audio cache : Yes',
    'Make use of C2 pointers : No',
    'Read offset correction : 6',
    'Fill up missing offset samples with silence : Yes',
    'Delete leading and trailing silent blocks : No',
    'Null samples used in CRC calculations : Yes',
    'Gap handling : Appended to previous track',
    'Track 1',
    'Track quality 100.0 %',
    'Test CRC ABCD1234',
    'Copy CRC ABCD1234',
    'Accurately ripped (confidence 5)',
    'Copy OK',
    'All tracks accurately ripped',
    '==== Log checksum DEADBEEFCAFE ===='
  ];
}

/** Replace the first line matching `pat`; drop it entirely when `to` is null. */
function edit(lines: string[], pat: RegExp, to: string | null): string[] {
  const out: string[] = [];
  let done = false;
  for (const l of lines) {
    if (!done && pat.test(l)) {
      done = true;
      if (to !== null) out.push(to);
      continue;
    }
    out.push(l);
  }
  return out;
}

describe('scoreEac', () => {
  it('scores a perfect secure rip at 100 with no deductions', () => {
    const { score, deductions } = scoreEac(perfectEac(), 1.3);
    expect(score).toBe(100);
    expect(deductions).toEqual([]);
  });

  it('subtracts 10 for C2 pointers, then AccurateRip boosts to 97', () => {
    const lines = edit(
      perfectEac(),
      /Make use of C2 pointers/,
      'Make use of C2 pointers : Yes'
    );
    const { score, deductions } = scoreEac(lines, 1.3);
    expect(score).toBe(97);
    expect(
      deductions.some((d) => /C2 pointers were used/.test(d.message))
    ).toBe(true);
    expect(deductions.some((d) => /boosted only to 97/.test(d.message))).toBe(
      true
    );
  });

  it('subtracts 5 for not filling with silence, then AccurateRip boosts to 100', () => {
    const lines = edit(
      perfectEac(),
      /Fill up missing offset samples/,
      'Fill up missing offset samples with silence : No'
    );
    const { score, deductions } = scoreEac(lines, 1.3);
    expect(score).toBe(100);
    expect(
      deductions.some((d) => /fill offset samples with silence/.test(d.message))
    ).toBe(true);
    expect(deductions.some((d) => /boosted to 100/.test(d.message))).toBe(true);
  });

  it('subtracts 30 for a CRC mismatch (no AccurateRip rescue)', () => {
    const lines = edit(perfectEac(), /^Copy CRC/, 'Copy CRC 99999999');
    const { score, deductions } = scoreEac(lines, 1.3);
    expect(score).toBe(70);
    expect(
      deductions.some((d) => /CRC mismatch on track 1/.test(d.message))
    ).toBe(true);
  });

  it('boosts a no-Test-&-Copy but AccurateRip-verified rip to 97', () => {
    const lines = edit(perfectEac(), /^Test CRC/, null);
    const { score, deductions } = scoreEac(lines, 1.3);
    expect(score).toBe(97);
    expect(
      deductions.some((d) => /not done using Test & Copy/.test(d.message))
    ).toBe(true);
  });

  it('FAILs (0) when normalization was applied', () => {
    const lines = [...perfectEac()];
    lines.splice(2, 0, 'Normalize to 100% (would clip)');
    const { score, deductions } = scoreEac(lines, 1.3);
    expect(score).toBe(0);
    expect(
      deductions.some((d) => /Ripped with normalization/.test(d.message))
    ).toBe(true);
  });

  it('FAILs (0) when no tracks are present', () => {
    const lines = perfectEac().filter(
      (l) =>
        !/^(Track 1|Track quality|Test CRC|Copy CRC|Accurately ripped|Copy OK)/.test(
          l
        )
    );
    const { score, deductions } = scoreEac(lines, 1.3);
    expect(score).toBe(0);
    expect(deductions.some((d) => /No tracks found/.test(d.message))).toBe(
      true
    );
  });

  it('FAILs (0) for an EAC version newer than the max approved', () => {
    const { score, deductions } = scoreEac(perfectEac(), 9999);
    expect(score).toBe(0);
    expect(
      deductions.some((d) => /version is not approved/.test(d.message))
    ).toBe(true);
  });
});
