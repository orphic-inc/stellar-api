/**
 * XLD (X Lossless Decoder) log scorer — ported from log_checker_xld.class.php.
 *
 * Unlike the EAC scorer, XLD decrements a running score from 100 in place. Version
 * is the 8-digit build date (e.g. 20100704); several rules gate on date ranges that
 * correspond to when XLD gained gap detection and AccurateRip support.
 */
import { Deduction, normalizeLine } from './types';

const SETTINGS: Record<string, string> = {
  'Used drive': 'useddrive',
  'Use cdparanoia mode': 'cdparanoia',
  'Ripper mode': 'ripper',
  'Disable audio cache': 'nocache',
  'Make use of C2 pointers': 'c2',
  'Read offset correction': 'offset',
  'Gap status': 'gapstatus',
  'Album gain': 'albumgain',
  Peak: 'peak'
};

type Bag = Record<string, string | number | undefined>;

interface XldScore {
  score: number;
  deductions: Deduction[];
}

/**
 * @param lines  log lines AFTER the "X Lossless Decoder …" header is shifted off.
 * @param ver    the 8-digit build date as a number (e.g. 20100704).
 */
export function scoreXld(lines: string[], ver: number): XldScore {
  const RipInfo: Bag = {};
  const Track: Record<number, Bag> = {};
  const rs = (k: string): string =>
    typeof RipInfo[k] === 'string' ? (RipInfo[k] as string) : '';

  // ── parse ────────────────────────────────────────────────────────────
  let TrackData = false;
  let TrackNumber = 0;
  let AACont = true;
  let ARSig = false;
  let VerifyPG = false;
  let HTOAPG = false;
  let SecureRipper = false;
  let HasChecksum = false;

  for (const raw of lines) {
    const Line = normalizeLine(raw);
    if (!Line) continue;

    if (/XLD extraction logfile/.test(Line)) continue;
    if (AACont) {
      AACont = false;
      continue;
    }
    if (/-----BEGIN XLD SIGNATURE-----/.test(Line)) {
      HasChecksum = true;
      continue;
    }
    if (!ARSig && /AccurateRip signature/.test(Line)) ARSig = true;

    let m: RegExpMatchArray | null;
    if ((m = Line.match(/^Track (\d+)$/))) {
      TrackData = true;
      TrackNumber = parseInt(m[1].replace(/^0+/, '') || '0', 10);
      continue;
    }

    if (!TrackData) {
      if (Line.includes(':')) {
        const parts = Line.split(':');
        const key = parts[0].trim();
        if (SETTINGS[key]) RipInfo[SETTINGS[key]] = parts[1].trim();
      }
    } else {
      if (Object.keys(Track).length === 0) {
        SecureRipper = rs('ripper') === 'XLD Secure Ripper';
        if (ver === 20100511 && /Pre-gap length/.test(Line)) {
          const pg = Line.slice(17).trim();
          if (pg !== '00:02:00') HTOAPG = true;
        }
      }
      if (Object.keys(Track).length >= 2 && ARSig && !VerifyPG) {
        VerifyPG = /Pre-gap length/.test(Line);
      }
      // Track bags are created lazily on the first matching attribute (not on the
      // "Track N" header), so the size checks above see only tracks with real data.
      const set = (k: string, v: string | number) => {
        (Track[TrackNumber] ??= {})[k] = v;
      };
      if (Line === 'Track not present in AccurateRip database') {
        set('ar', 0);
      } else if (
        (m = Line.match(/->Accurately ripped! \((?:AR2, )?confidence (\d+)\)/))
      ) {
        set('ar', parseInt(m[1], 10));
      } else if (/^Track gain/.test(Line)) {
        set('gain', 1);
      } else if (/^Peak/.test(Line)) {
        set('peak', 1);
      } else if ((m = Line.match(/^CRC32 hash \(test run\) : ([A-Z0-9]+)$/))) {
        set('testcrc', m[1]);
      } else if ((m = Line.match(/^CRC32 hash : ([A-Z0-9]+)$/))) {
        set('copycrc', m[1]);
      } else if ((m = Line.match(/^Read error : (\d+)/))) {
        set('readerror', m[1]);
      } else if (SecureRipper) {
        if ((m = Line.match(/^Damaged sector count : (\d+)/)))
          set('damaged', m[1]);
      } else {
        if ((m = Line.match(/^Skipped \(treated as error\) : (\d+)/)))
          set('skipped', m[1]);
        else if ((m = Line.match(/^Inconsistency in error sectors : (\d+)/)))
          set('inconsistency', m[1]);
      }
    }
  }

  const trackKeys = Object.keys(Track)
    .map(Number)
    .sort((a, b) => a - b);
  const TrackCount = trackKeys.length;

  // ── score ────────────────────────────────────────────────────────────
  const deductions: Deduction[] = [];
  let FinalScore = 100;
  let AllowAROverride = true;
  let NoTestAndCopy = false;
  let DmgDeduct = false;
  let ConDeduct = false;
  let GPDeducted = false;

  const sub = (points: number, message: string) => {
    FinalScore -= points;
    deductions.push({ message, points });
  };

  if (HTOAPG) {
    sub(1, 'XLD 2010/05/11 — track 1 pre-gap longer than 2 seconds, -1 point');
    AllowAROverride = false;
  }
  if (ver < 20100123) {
    sub(20, 'Pre-2010/01/23 version of XLD (no gap detection), -20 points');
    AllowAROverride = false;
  }
  if (!ARSig && ver >= 20100123 && ver < 20100704) {
    sub(
      20,
      'XLD 2010/01/23–2010/07/04 with AccurateRip not enabled, -20 points'
    );
    AllowAROverride = false;
  }
  if (!VerifyPG && ver >= 20100123 && ver < 20100704) {
    sub(
      1,
      'XLD 2010/01/23–2010/07/04 cannot verify detected gaps, -1 point (does not affect audio data)'
    );
    AllowAROverride = false;
  }

  for (const i of trackKeys) {
    const t = Track[i];
    if (!GPDeducted && t.gain === undefined) {
      sub(
        1,
        'No "Scan ReplayGain" info (does not affect audio data), -1 point'
      );
      GPDeducted = true;
    }
    if (!GPDeducted && t.peak === undefined) {
      sub(
        1,
        'No "Scan ReplayGain" info (does not affect audio data), -1 point'
      );
      GPDeducted = true;
    }
    if (Number(t.readerror) > 0)
      sub(20, `Read error(s) found on track ${i}, -20 points`);
    if (t.skipped !== undefined)
      sub(20, `Skip(s) found on track ${i}, -20 points`);
    if (t.inconsistency !== undefined)
      sub(
        20,
        `Inconsistency in error sector(s) found on track ${i}, -20 points`
      );
    if (Number(t.damaged) > 0)
      sub(20, `Damaged sectors found on track ${i}, -20 points`);

    if (SecureRipper) {
      if (t.damaged === undefined && !DmgDeduct) {
        DmgDeduct = true;
        sub(5, 'Damaged sector count not found on every track, -5 points');
      }
    } else {
      if (t.inconsistency === undefined && !ConDeduct) {
        ConDeduct = true;
        sub(
          5,
          'Inconsistency in error sector(s) not found on every track, -5 points'
        );
      }
    }

    if (t.testcrc !== undefined) {
      if (t.testcrc !== t.copycrc) {
        AllowAROverride = false;
        sub(30, `CRC mismatch on track ${i}, -30 points`);
        if (/^NO/.test(rs('cdparanoia'))) {
          sub(
            20,
            `CRC mismatch AND not ripped in secure mode on track ${i}, -20 points`
          );
        }
      }
    } else {
      NoTestAndCopy = true;
      sub(1, `No test before copy on track ${i}, -1 point`);
      if (/^NO/.test(rs('cdparanoia'))) {
        sub(
          40,
          `No test before copy AND not ripped using cdparanoia on track ${i}, -40 points`
        );
      }
    }

    if (t.ar === undefined || (t.ar as number) < 2) AllowAROverride = false;
  }

  if (!TrackCount) {
    deductions.push({ message: 'No tracks found. [FAIL]', points: 0 });
    FinalScore = 0;
    AllowAROverride = false;
  }

  if (ver >= 20100704) {
    const gap = rs('gapstatus');
    if (/Not Analyzed, Appended/.test(gap)) {
      sub(1, 'Gaps not analyzed but appended, -1 point');
      AllowAROverride = false;
    } else if (
      gap === '' ||
      !/^Analyzed, Appended( \(except HTOA\))?$/.test(gap)
    ) {
      sub(20, 'Gaps not detected/appended to previous track, -20 points');
      AllowAROverride = false;
    }
  }

  if (!GPDeducted && RipInfo.albumgain === undefined) {
    sub(1, 'No "Scan ReplayGain" info (does not affect audio data), -1 point');
    GPDeducted = true;
  }
  if (!GPDeducted && RipInfo.peak === undefined) {
    sub(5, 'No "Scan ReplayGain" info (does not affect audio data), -5 points');
    GPDeducted = true;
  }

  if (!SecureRipper && !/^CDParanoia III \d+\.?\d+$/.test(rs('ripper'))) {
    if (/^NO/.test(rs('cdparanoia'))) {
      sub(
        1,
        'The rip was not done using cdparanoia. This is a poor setting and compounds other deductions, -1 point'
      );
    } else {
      const match = rs('cdparanoia').match(/(\d+\.?\d+) engine\)$/);
      if (!match || parseFloat(match[1]) < 10.2) {
        sub(
          10,
          "cdparanoia versions earlier than 10.2 can't defeat the cache properly, -10 points"
        );
      }
    }
  }

  if (/^NO/.test(rs('nocache')))
    sub(5, "'Defeat audio cache' disabled, -5 points");
  if (rs('c2').toLowerCase() === 'yes')
    sub(10, 'C2 pointers were used, -10 points');
  // (Legacy drive read-offset check intentionally omitted — see types.ts.)

  if (!HasChecksum) {
    AllowAROverride = false;
    sub(
      1,
      'XLD checksum plugin not installed (no XLD signature present), -1 point'
    );
  }

  if (AllowAROverride && FinalScore < 100) {
    if (NoTestAndCopy) {
      deductions.push({
        message:
          'All tracks were verified by AccurateRip (confidence ≥ 2). Without test before copy, the score is boosted only to 97.',
        points: 0
      });
      FinalScore = 97;
    } else {
      deductions.push({
        message:
          'All tracks were verified by AccurateRip (confidence ≥ 2). The score has been boosted to 100.',
        points: 0
      });
      FinalScore = 100;
    }
  }

  return { score: FinalScore, deductions };
}
