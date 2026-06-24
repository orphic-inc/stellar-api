/**
 * XLD scorer — branch coverage with synthetic minimal logs.
 *
 * `scoreXld` receives the lines AFTER the "X Lossless Decoder …" header is shifted
 * off. The first non-"XLD extraction logfile" line is consumed as the AA line.
 *
 * Note: the legacy AccurateRip regex matches "->Accurately ripped! (confidence N)"
 * (optionally "AR2, "), NOT the modern "->Accurately ripped (v1+v2, confidence X/Y)"
 * spelling. The synthetic logs here use the matched spelling so the AR-override path
 * is exercised; the real-fixture spec covers the modern spelling end to end.
 */
import { scoreXld } from './xld';

const VER = 20161007; // a modern build: gap detection + AR era

/** A minimal, verified-perfect XLD Secure Ripper rip (one track). */
function perfectXld(): string[] {
  return [
    'XLD extraction logfile from 2016-12-15 03:45:11 -0500',
    'Various Artists / Album', // consumed as the AA continuation line
    'Used drive : Some Drive',
    'Ripper mode : XLD Secure Ripper',
    'Disable audio cache : OK for the drive with a cache less than 1375KiB',
    'Make use of C2 pointers : NO',
    'Read offset correction : 6',
    'Gap status : Analyzed, Appended (except HTOA)',
    'Album gain : -8.18 dB',
    'Peak : 1.000000',
    'AccurateRip signature : DEADBEEF',
    '-----BEGIN XLD SIGNATURE-----',
    'Track 01',
    'Track gain : 0.60 dB',
    'Peak : 0.528900',
    'CRC32 hash (test run) : 17AE22BD',
    'CRC32 hash : 17AE22BD',
    'Damaged sector count : 0',
    '->Accurately ripped! (confidence 9)'
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

describe('scoreXld', () => {
  it('scores a perfect secure rip at 100 with no deductions', () => {
    const { score, deductions } = scoreXld(perfectXld(), VER);
    expect(score).toBe(100);
    expect(deductions).toEqual([]);
  });

  it('subtracts 20 for a read error (no AccurateRip rescue when ar is absent)', () => {
    let lines = edit(perfectXld(), /->Accurately ripped/, null);
    lines = [...lines];
    lines.splice(
      lines.indexOf('Damaged sector count : 0') + 1,
      0,
      'Read error : 5'
    );
    const { score, deductions } = scoreXld(lines, VER);
    expect(score).toBe(80);
    expect(
      deductions.some((d) => /Read error\(s\) found on track 1/.test(d.message))
    ).toBe(true);
  });

  it('subtracts 30 for a CRC mismatch', () => {
    const lines = edit(perfectXld(), /^CRC32 hash : /, 'CRC32 hash : 99999999');
    const { score, deductions } = scoreXld(lines, VER);
    expect(score).toBe(70);
    expect(
      deductions.some((d) => /CRC mismatch on track 1/.test(d.message))
    ).toBe(true);
  });

  it('subtracts 20 for a pre-2010/01/23 build (no gap detection)', () => {
    const { score, deductions } = scoreXld(perfectXld(), 20090101);
    expect(score).toBe(80);
    expect(deductions.some((d) => /Pre-2010\/01\/23/.test(d.message))).toBe(
      true
    );
  });

  it('subtracts 1 when the XLD signature (checksum) is missing', () => {
    const lines = edit(perfectXld(), /-----BEGIN XLD SIGNATURE-----/, null);
    const { score, deductions } = scoreXld(lines, VER);
    expect(score).toBe(99);
    expect(
      deductions.some((d) =>
        /XLD checksum plugin not installed/.test(d.message)
      )
    ).toBe(true);
  });

  it('boosts an AccurateRip-verified rip missing ReplayGain back to 100', () => {
    const lines = edit(perfectXld(), /^Track gain/, null);
    const { score, deductions } = scoreXld(lines, VER);
    expect(score).toBe(100);
    expect(deductions.some((d) => /boosted to 100/.test(d.message))).toBe(true);
  });

  it('boosts a no-test-before-copy but AccurateRip-verified rip to 97', () => {
    const lines = edit(perfectXld(), /CRC32 hash \(test run\)/, null);
    const { score, deductions } = scoreXld(lines, VER);
    expect(score).toBe(97);
    expect(deductions.some((d) => /boosted only to 97/.test(d.message))).toBe(
      true
    );
  });

  it('FAILs when no tracks are present (raw scorer may go negative; checkLog clamps)', () => {
    const lines = perfectXld().filter(
      (l) =>
        !/^(Track 01|Track gain|Peak : 0|CRC32 hash|Damaged sector count|->Accurately)/.test(
          l
        )
    );
    const { score, deductions } = scoreXld(lines, VER);
    // Faithful to legacy: the no-tracks FAIL sets 0, then later rules still subtract
    // (SecureRipper is only learned while parsing tracks, so the cdparanoia rule fires).
    expect(score).toBeLessThanOrEqual(0);
    expect(deductions.some((d) => /No tracks found/.test(d.message))).toBe(
      true
    );
  });
});
