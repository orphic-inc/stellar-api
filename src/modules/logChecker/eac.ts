/**
 * EAC (Exact Audio Copy) log scorer — ported from the legacy log_checker_eac.class.php.
 *
 * Two-phase, matching the original: parse() builds per-settings-block and per-track
 * bags from the log lines, then score() applies deductions from a starting 100.
 * The AccurateRip override can restore an otherwise-imperfect-but-verified rip to
 * 100 (or 97 when it lacked Test & Copy / used C2).
 */
import { Deduction, normalizeLine } from './types';

const MAX_ALLOWED_VERSION = 1.3;

// Setting label (lowercased) → internal key, mirroring the legacy $Settings map.
const SETTINGS: Record<string, string> = {
  'used drive': 'useddrive',
  'read mode': 'readmode',
  'utilize accurate stream': 'accuratestream',
  'defeat audio cache': 'nocache',
  'make use of c2 pointers': 'c2',
  'read offset correction': 'offset',
  'fill up missing offset samples with silence': 'fillwithsilence',
  'delete leading and trailing silent blocks': 'trimsilence',
  'null samples used in crc calculations': 'usenulls',
  'gap handling': 'gaphandling',
  'normalize to': 'normalize',
  'use compression offset': 'compression',
  'combined read/write offset correction': 'combinedoffset'
};

type Bag = Record<string, string | number | undefined>;

interface EacScore {
  score: number;
  deductions: Deduction[];
}

/**
 * @param lines  log lines AFTER the version header line has been shifted off (as the
 *               legacy helper does before handing the remainder to the checker).
 * @param ver    EAC version as a float (0.95, 0.99, 1.0…), detected from the header.
 */
export function scoreEac(lines: string[], ver: number): EacScore {
  const RipInfo: Bag[] = [];
  const Track: Record<number, Bag> = {};

  const ri = (i: number): Bag => (RipInfo[i] ??= {});
  const rs = (i: number, k: string): string =>
    typeof RipInfo[i]?.[k] === 'string' ? (RipInfo[i]![k] as string) : '';

  // ── parse ────────────────────────────────────────────────────────────
  let TrackData = false;
  let SettingsIndex = 0;
  let TrackNumber = 0;
  let AllAR = true;
  let AACont = true;

  for (const raw of lines) {
    const Line = normalizeLine(raw);
    if (!Line) continue;

    if (/EAC extraction logfile/.test(Line)) {
      continue;
    }
    if (AACont) {
      AACont = false;
      continue;
    }
    if (/^==== Log checksum/.test(Line)) {
      ri(SettingsIndex).checksum = 1;
      continue;
    }
    if (/^-{60}$/.test(Line)) {
      SettingsIndex++;
    }

    let m: RegExpMatchArray | null;
    if ((m = Line.match(/^Track (\d+)$/))) {
      TrackData = true;
      TrackNumber = parseInt(m[1], 10);
      Track[TrackNumber] = { settingsindex: SettingsIndex };
      continue;
    }

    if (!TrackData) {
      if (/^Normalize to/.test(Line)) {
        ri(SettingsIndex).normalize = 1;
      }
      if (Line.includes(':')) {
        const parts = Line.split(':');
        const key = parts[0].trim().toLowerCase();
        if (SETTINGS[key]) {
          ri(SettingsIndex)[SETTINGS[key]] = parts[1].trim();
        }
      }
      if (/^All tracks accurately ripped$/.test(Line)) {
        ri(SettingsIndex).accuraterip = 1;
      }
      if ((m = Line.match(/^(\d+) track\(s\) accurately ripped$/))) {
        ri(SettingsIndex).accuratelyripped = parseInt(m[1], 10);
      }
      if (/^==== Log checksum/.test(Line)) {
        ri(SettingsIndex).checksum = 1;
      }
    } else {
      const t = Track[TrackNumber];
      if (Line === 'Track not present in AccurateRip database') {
        t.ar = 0;
      } else if ((m = Line.match(/Accurately ripped \(confidence (\d+)\)/))) {
        t.ar = parseInt(m[1], 10);
      } else if (/^Cannot be verified as accurate/.test(Line)) {
        t.ar = 0;
      } else if ((m = Line.match(/^Test CRC ([A-Z0-9]+)$/))) {
        t.testcrc = m[1];
      } else if ((m = Line.match(/^Copy CRC ([A-Z0-9]+)$/))) {
        t.copycrc = m[1];
      } else if (/^Suspicious position/.test(Line)) {
        t.suspicious =
          (typeof t.suspicious === 'number' ? t.suspicious : 0) + 1;
      } else if (/^Timing problem/.test(Line)) {
        t.timing = (typeof t.timing === 'number' ? t.timing : 0) + 1;
      } else if (/^Missing sample/.test(Line)) {
        t.missing = (typeof t.missing === 'number' ? t.missing : 0) + 1;
      } else if (/^Track quality/.test(Line)) {
        t.quality = 1;
      } else if (/^Pre-gap length/.test(Line) && TrackNumber === 1) {
        t['095gaps'] = 1;
      } else if ((m = Line.match(/^Copy (OK|finished|aborted)$/))) {
        t.copy = m[1];
        if (t.ar === undefined && m[1] !== 'aborted') {
          AllAR = false;
        }
        TrackData = false;
      }
    }
  }

  // EAC 0.95 logs pack read mode + flags into the readmode line.
  for (let i = 0; i <= SettingsIndex; i++) {
    const rm = RipInfo[i]?.readmode;
    if (typeof rm === 'string' && rm.includes(',')) {
      const block = ri(i);
      block.version = '0.95';
      const [ReadMode, C2, AccurateStream, DisableCache] = rm.split(/with|,/);
      block.readmode = (ReadMode ?? '').trim();
      block.c2 = (C2 ?? '').startsWith(' NO') ? 'No' : 'Yes';
      block.accuratestream = (AccurateStream ?? '').startsWith(' NO')
        ? 'No'
        : 'Yes';
      block.nocache = (DisableCache ?? '').startsWith(' NO') ? 'No' : 'Yes';
    }
  }

  const trackKeys = Object.keys(Track)
    .map(Number)
    .sort((a, b) => a - b);
  const TrackCount = trackKeys.length;

  // ── score ────────────────────────────────────────────────────────────
  const deductions: Deduction[] = [];
  let Subtractions = 0;
  let StartScore = 100;
  let AllowAROverride = true;
  let NoTestAndCopy = false;
  let C2Used = false;
  let Insecure = false;
  let VersionDeduction = false;
  let FailMessage: string | null = null;

  const sub = (points: number, message: string) => {
    Subtractions += points;
    deductions.push({ message, points });
  };
  const fail = (message: string) => {
    StartScore = 0;
    AllowAROverride = false;
    deductions.push({ message, points: 0 });
  };

  for (const i of trackKeys) {
    const t = Track[i];
    const idx = t.settingsindex as number;
    if (RipInfo[idx]?.version === undefined) ri(idx).version = '';

    if (rs(idx, 'version') === '0.95' && i === 1) {
      if (t['095gaps'] === undefined) {
        sub(
          1,
          `Gaps not detected/appended to previous track on track ${i}, -1 point (does not affect audio data)`
        );
      }
    }
    if (t.suspicious !== undefined)
      sub(20, `Suspicious position(s) found on track ${i}, -20 points`);
    if (t.timing !== undefined)
      sub(20, `Timing problem(s) found on track ${i}, -20 points`);
    if (t.missing !== undefined)
      sub(20, `Missing sample(s) found on track ${i}, -20 points`);
    if (t.copy !== undefined && t.copy !== 'OK')
      sub(5, `Copy not OK for track ${i}, -5 points`);

    if (t.testcrc !== undefined) {
      if (t.testcrc !== t.copycrc) {
        AllowAROverride = false;
        sub(30, `CRC mismatch on track ${i}, -30 points`);
        if (rs(idx, 'readmode') !== 'Secure') {
          sub(
            20,
            `CRC mismatch AND not ripped in secure mode on track ${i}, -20 points`
          );
        }
      }
    } else {
      NoTestAndCopy = true;
      if (rs(idx, 'readmode') !== 'Secure') Insecure = true;
    }

    if (t.ar === undefined || t.ar === 0) {
      AllowAROverride = false;
      if (RipInfo[idx]?.accuraterip !== undefined) {
        FailMessage = 'Sorry, this rip is invalid. [FAIL]';
        StartScore = 0;
      }
    } else {
      if (rs(idx, 'version') === '0.95') {
        FailMessage = 'Sorry, this rip is invalid. [FAIL]';
        StartScore = 0;
        AllowAROverride = false;
      }
      if ((t.ar as number) < 2) AllowAROverride = false;
    }

    if (
      t.quality === undefined &&
      rs(idx, 'readmode') === 'Secure' &&
      rs(idx, 'version') !== '0.95'
    ) {
      // Secure-mode logs always print a per-track "Track quality" line; its absence
      // means the log was doctored.
      FailMessage = 'Sorry, this rip is invalid. [FAIL]';
      StartScore = 0;
      AllowAROverride = false;
    }
  }

  if (!TrackCount) {
    deductions.push({
      message: 'No tracks found, did you rip this as a range? [FAIL]',
      points: 0
    });
    StartScore = 0;
    AllowAROverride = false;
  }

  // Only inspect settings blocks that tracks actually used (ignore re-ripped chunks).
  const settingsQueue = [
    ...new Set(trackKeys.map((i) => Track[i].settingsindex as number))
  ];

  for (const idx of settingsQueue) {
    if (RipInfo[idx]?.accuratelyripped !== undefined) {
      if ((RipInfo[idx]!.accuratelyripped as number) >= TrackCount) {
        fail('Sorry, this rip is invalid. [FAIL]');
      }
    }
    if (RipInfo[idx]?.normalize !== undefined)
      fail('Ripped with normalization. [FAIL]');
    if (RipInfo[idx]?.compression !== undefined)
      fail('Ripped with compression offset. [FAIL]');

    if (rs(idx, 'readmode') !== 'Secure') {
      sub(
        1,
        'The rip was not done in secure mode. This is a poor setting and compounds other deductions, -1 point'
      );
    }
    if (rs(idx, 'nocache') !== 'Yes' && rs(idx, 'readmode') !== 'Burst') {
      sub(5, "'Defeat audio cache' should be yes, -5 points");
    }
    if (rs(idx, 'c2') === 'Yes') {
      sub(10, 'C2 pointers were used, -10 points');
      C2Used = true;
    }
    if (rs(idx, 'fillwithsilence') !== 'Yes') {
      sub(5, 'Does not fill offset samples with silence, -5 points');
    }
    if (ver > 0.95 && rs(idx, 'usenulls') !== 'Yes') {
      sub(1, 'Not using null samples (does not affect audio data), -1 point');
      AllowAROverride = false;
    }
    if (rs(idx, 'trimsilence') === 'Yes') {
      sub(5, 'Deletes leading and trailing silent blocks, -5 points');
    }

    if (ver > 0.95) {
      const gap = rs(idx, 'gaphandling');
      if (gap === 'Appended to next track') {
        sub(20, 'Gaps appended to next track, -20 points');
        AllowAROverride = false;
      } else if (gap === 'Left out') {
        sub(20, 'Gaps left out, -20 points');
        AllowAROverride = false;
      } else if (
        gap !== 'Appended to previous track' &&
        rs(idx, 'version') !== '0.95'
      ) {
        sub(
          1,
          'Gaps not detected/appended to previous track, -1 point (does not affect audio data)'
        );
        AllowAROverride = false;
      }
    }

    if (ver < 1.0) {
      if (RipInfo[idx]?.checksum !== undefined) {
        fail('Sorry, this rip is invalid [FAIL]');
      } else if (!VersionDeduction) {
        sub(1, 'Not ripped with EAC v1.0 or higher (no checksums), -1 point');
        AllowAROverride = false;
        VersionDeduction = true;
      }
    } else if (ver > MAX_ALLOWED_VERSION) {
      fail('Sorry, this EAC version is not approved (yet) [FAIL]');
    }

    if (ver >= 1.0 && RipInfo[idx]?.checksum === undefined) {
      sub(1, 'Log checksum not used, -1 point');
      AllowAROverride = false;
    }
    if (!AllAR && ver !== 0.95) {
      sub(10, 'AccurateRip not enabled for every track, -10 points');
      AllowAROverride = false;
    }
    if (RipInfo[idx]?.combinedoffset !== undefined) {
      sub(5, 'Combined read/write offset cannot be verified, -5 points');
      AllowAROverride = false;
    }
    // (Legacy drive read-offset check intentionally omitted — see types.ts.)
  }

  if (NoTestAndCopy) {
    sub(10, 'This rip was not done using Test & Copy, -10 points');
    if (Insecure)
      sub(40, 'No Test & Copy AND not ripped in secure mode, -40 points');
  }

  // AccurateRip override — rescue a verified-but-imperfect rip.
  if (AllowAROverride && StartScore === 100 && Subtractions > 0) {
    if (NoTestAndCopy || C2Used) {
      deductions.push({
        message:
          'All tracks were verified by AccurateRip (confidence ≥ 2). Without Test & Copy and/or with C2 pointers, the score is boosted only to 97.',
        points: 0
      });
      Subtractions = 3;
    } else {
      deductions.push({
        message:
          'All tracks were verified by AccurateRip (confidence ≥ 2). The score has been boosted to 100.',
        points: 0
      });
      Subtractions = 0;
    }
  }

  if (FailMessage) deductions.push({ message: FailMessage, points: 0 });

  return { score: StartScore - Subtractions, deductions };
}
