import { FileType } from '@prisma/client';

/**
 * Per-contribution quality grade — the other half of the community signal
 * alongside the link-health pulse (ADR-0002). A lossless, logged, cued rip is
 * worth more to a community than a low-bitrate transcode.
 *
 * Graded off today's existing Contribution fields; the bitrate parsing here is
 * best-effort and firms up once the typed `Bitrate`/`ReleaseMedia` enums land
 * (#72). This is the grade only — weighting it into the CommunityScore comes
 * once the pulse and quality signals are combined.
 */

export type QualityTier =
  | 'Perfect'
  | 'Lossless'
  | 'HighLossy'
  | 'MidLossy'
  | 'LowLossy'
  | 'Unknown';

export interface ContributionQuality {
  tier: QualityTier;
  /** 0–1 weight for the community score; `null` when ungradeable. */
  score: number | null;
}

export interface ContributionQualityInput {
  /** File format. */
  type: FileType;
  /** Free-string bitrate today (e.g. "320", "V0", "Lossless"); typed later (#72). */
  bitrate?: string | null;
  hasLog?: boolean;
  hasCue?: boolean;
}

const TIER_SCORE: Record<Exclude<QualityTier, 'Unknown'>, number> = {
  Perfect: 1,
  Lossless: 0.9,
  HighLossy: 0.7,
  MidLossy: 0.5,
  LowLossy: 0.3
};

// FLAC-class: a log + cue (a verified rip) lifts these to Perfect.
const RIPPABLE_LOSSLESS = new Set<FileType>([FileType.flac]);
// Lossless, but no log/cue "perfect rip" concept applies.
const OTHER_LOSSLESS = new Set<FileType>([FileType.wav]);
const LOSSY_FORMATS = new Set<FileType>([
  FileType.mp3,
  FileType.aac,
  FileType.ogg,
  FileType.m4a,
  FileType.m4b
]);

const HIGH_LOSSY = new Set(['320', 'v0']);
const MID_LOSSY = new Set(['256', 'v2', '224']);
const LOW_LOSSY = new Set(['192', '160', '128', '96', '64']);

const normalizeBitrate = (bitrate?: string | null): string =>
  (bitrate ?? '').toLowerCase().replace(/kbps/g, '').replace(/\s+/g, '');

const grade = (tier: QualityTier): ContributionQuality => ({
  tier,
  score: tier === 'Unknown' ? null : TIER_SCORE[tier]
});

export const gradeContribution = (
  input: ContributionQualityInput
): ContributionQuality => {
  const { type, bitrate, hasLog, hasCue } = input;
  const br = normalizeBitrate(bitrate);

  if (RIPPABLE_LOSSLESS.has(type)) {
    return grade(hasLog && hasCue ? 'Perfect' : 'Lossless');
  }
  if (OTHER_LOSSLESS.has(type)) {
    return grade('Lossless');
  }
  if (LOSSY_FORMATS.has(type)) {
    if (HIGH_LOSSY.has(br)) return grade('HighLossy');
    if (MID_LOSSY.has(br)) return grade('MidLossy');
    if (LOW_LOSSY.has(br)) return grade('LowLossy');
    // A lossless bitrate marker on a nominally-lossy container (e.g. ALAC/m4a).
    if (br === 'lossless' || br === '1411' || br.includes('24bit')) {
      return grade('Lossless');
    }
    return grade('Unknown');
  }
  return grade('Unknown');
};
