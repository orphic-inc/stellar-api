import { Bitrate, FileType } from '@prisma/client';

/**
 * Per-contribution quality grade — the other half of the community signal
 * alongside the link-health pulse (ADR-0002). A lossless, logged, cued rip is
 * worth more to a community than a low-bitrate transcode.
 *
 * Reads the typed `Bitrate` enum (#72), now carried per-file on the
 * `ReleaseFile` satellite (ADR-0008) rather than parsed from a free string.
 * The caller pulls `type` off the Contribution spine and `bitrate`/`hasLog`/
 * `hasCue` off its `ReleaseFile`. This is the grade only; weighting it into the
 * CommunityScore comes once the pulse and quality signals are combined.
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
  /** File format, off the Contribution spine. */
  type: FileType;
  /** Typed bitrate off the ReleaseFile satellite (#72 / ADR-0008). */
  bitrate?: Bitrate | null;
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

// Typed bitrate → lossy tier. `Lossless`/`Lossless24` markers on a
// nominally-lossy container (e.g. ALAC in .m4a) grade as Lossless; `Other` or
// an unset bitrate is ungradeable.
const HIGH_LOSSY = new Set<Bitrate>([Bitrate.Kbps320, Bitrate.KbpsV0]);
const MID_LOSSY = new Set<Bitrate>([Bitrate.Kbps256, Bitrate.KbpsV2]);
const LOW_LOSSY = new Set<Bitrate>([Bitrate.Kbps192, Bitrate.Kbps128]);
const LOSSLESS_MARKERS = new Set<Bitrate>([
  Bitrate.Lossless,
  Bitrate.Lossless24
]);

const grade = (tier: QualityTier): ContributionQuality => ({
  tier,
  score: tier === 'Unknown' ? null : TIER_SCORE[tier]
});

export const gradeContribution = (
  input: ContributionQualityInput
): ContributionQuality => {
  const { type, bitrate, hasLog, hasCue } = input;

  if (RIPPABLE_LOSSLESS.has(type)) {
    return grade(hasLog && hasCue ? 'Perfect' : 'Lossless');
  }
  if (OTHER_LOSSLESS.has(type)) {
    return grade('Lossless');
  }
  if (LOSSY_FORMATS.has(type)) {
    if (!bitrate) return grade('Unknown');
    if (HIGH_LOSSY.has(bitrate)) return grade('HighLossy');
    if (MID_LOSSY.has(bitrate)) return grade('MidLossy');
    if (LOW_LOSSY.has(bitrate)) return grade('LowLossy');
    if (LOSSLESS_MARKERS.has(bitrate)) return grade('Lossless');
    return grade('Unknown');
  }
  return grade('Unknown');
};
