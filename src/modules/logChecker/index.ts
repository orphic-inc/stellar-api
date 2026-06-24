/**
 * Log checker — entry point.
 *
 * Detects the ripper and version from the log header (mirroring the legacy helper's
 * init()), then dispatches to the matching scorer. Returns a structured result; a
 * score of 100 (`isPerfect`) is what a FLAC contribution needs to earn the Perfect
 * quality grade.
 */
import { LogCheckResult, normalizeLine } from './types';
import { scoreEac } from './eac';
import { scoreXld } from './xld';

export { LogCheckResult, Deduction, Ripper } from './types';

function stripBom(data: string): string {
  if (data.charCodeAt(0) === 0xfeff) return data.slice(1);
  return data;
}

/**
 * Floor the score at 0. A scorer can drive its running total below 0 when
 * deductions stack on top of an already-failed rip (e.g. an XLD log with no tracks
 * sets 0, then later rules still subtract) — faithful to the legacy code, which let
 * the number go negative. The meaningful range is 0–100, so we clamp the floor at
 * the contract boundary while leaving the pure scorers untouched.
 */
function clampScore(score: number): number {
  return Math.max(0, score);
}

/**
 * @param rawLog the log as a **decoded Unicode string**. This does NOT transcode raw
 *   UTF-16 bytes (the legacy PHP did, via mb_convert_encoding) — callers are expected
 *   to have decoded the file already. In the contribute flow the browser decodes the
 *   pasted text, so UTF-16LE EAC logs arrive as proper Unicode. (If a future phase
 *   accepts raw file bytes server-side, restore byte-level UTF-16 transcoding here.)
 */
export function checkLog(rawLog: string): LogCheckResult {
  const data = stripBom(rawLog).replace(/\r\n|\r/g, '\n');
  const lines = data.split('\n');

  // Shift the header line off, matching the legacy helper before it dispatches.
  let first = normalizeLine(lines.shift() ?? '');
  if (/^Syrup /.test(first)) first = normalizeLine(lines.shift() ?? '');

  if (/^X Lossless Decoder/.test(first)) {
    const match = first.match(/(\d{8})/);
    const ver = match ? parseInt(match[1], 10) : 0;
    const { score, deductions } = scoreXld(lines, ver);
    const clamped = clampScore(score);
    return {
      ripper: 'XLD',
      version: ver ? String(ver) : null,
      score: clamped,
      isPerfect: clamped === 100,
      deductions
    };
  }

  if (
    first.startsWith('EAC extraction logfile ') ||
    first.startsWith('Exact Audio Copy ')
  ) {
    let ver: number;
    if (first.startsWith('Exact Audio Copy V0.99 prebeta')) {
      ver = 0.99;
    } else if (first.startsWith('Exact Audio Copy V1.')) {
      const m = first.match(/^Exact Audio Copy V1\.(\d) /);
      ver = m ? parseFloat('1.' + m[1]) : 9999;
    } else {
      ver = 0.95;
    }
    const { score, deductions } = scoreEac(lines, ver);
    const clamped = clampScore(score);
    return {
      ripper: 'EAC',
      version: String(ver),
      score: clamped,
      isPerfect: clamped === 100,
      deductions
    };
  }

  return {
    ripper: null,
    version: null,
    score: 0,
    isPerfect: false,
    deductions: [
      { message: 'Unrecognized log format — not an EAC or XLD log.', points: 0 }
    ]
  };
}
