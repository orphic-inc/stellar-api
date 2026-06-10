import { ArtistRole } from '@prisma/client';

// Releases credit artists by role (Main, Guest, …) via ReleaseArtist rather
// than a single artistId. These helpers keep the legacy `release.artist`
// display field alive by deriving it from the Main credit, so list/detail
// responses keep a stable shape while the model stays multi-artist.

export const releaseCreditsSelect = {
  select: { role: true, artist: { select: { id: true, name: true } } }
} as const;

type ArtistRef = { id: number; name: string };
type Credit = { role: ArtistRole; artist: ArtistRef };

export const primaryArtist = (
  credits: Credit[] | undefined | null
): ArtistRef | null => {
  if (!credits || credits.length === 0) return null;
  const main = credits.find((credit) => credit.role === ArtistRole.Main);
  return (main ?? credits[0]).artist;
};

// Replace a release's `credits` array with a derived `artist` display field.
export const withPrimaryArtist = <T extends { credits?: Credit[] }>(
  release: T
): Omit<T, 'credits'> & { artist: ArtistRef | null } => {
  const { credits, ...rest } = release;
  return { ...rest, artist: primaryArtist(credits) };
};
