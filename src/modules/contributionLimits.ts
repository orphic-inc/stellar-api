import { ReleaseType } from '@prisma/client';
import { AppError } from '../lib/errors';

// Per-ReleaseType upload ceilings (#93). The Zod `.max(Number.MAX_SAFE_INTEGER)`
// guard on `sizeInBytes` (#81) is an overflow guard, not a product limit — these
// are the real per-category ceilings. Every ReleaseType gets its own explicitly
// reasoned number; none silently shares another category's value. Values are a
// starting point and can be tuned here without a schema change.
export const CONTRIBUTION_SIZE_CAPS: Record<ReleaseType, number> = {
  Music: 20_000_000_000, // hi-res / SACD / large single contributions
  Applications: 100_000_000_000, // large software & game payloads
  ELearningVideos: 50_000_000_000, // long-form course bundles
  Audiobooks: 10_000_000_000, // unabridged long-form audio (own tier, not Music)
  Comedy: 10_000_000_000, // may be a video special (own tier, not Music)
  Comics: 2_000_000_000, // CBZ/CBR sets
  EBooks: 500_000_000 // PDF/EPUB ceiling
};

const formatBytes = (bytes: number): string =>
  bytes >= 1_000_000_000
    ? `${bytes / 1_000_000_000} GB`
    : `${bytes / 1_000_000} MB`;

// Throws a 413 when a client-supplied contribution size exceeds the ceiling for
// its release type. An omitted size is valid — `sizeInBytes` is optional. The
// boundary is inclusive: a size exactly at the cap is accepted.
export const assertWithinSizeCap = (
  type: ReleaseType,
  sizeInBytes?: number | null
): void => {
  if (sizeInBytes == null) return;
  const cap = CONTRIBUTION_SIZE_CAPS[type];
  if (sizeInBytes > cap) {
    throw new AppError(
      413,
      `Contribution size exceeds the ${formatBytes(
        cap
      )} limit for ${type} releases`
    );
  }
};
