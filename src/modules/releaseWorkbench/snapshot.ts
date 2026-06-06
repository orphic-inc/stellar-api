import type { Prisma } from '@prisma/client';

export type ReleaseSnapshot = {
  title: string;
  description: string;
  image: string | null;
  year: number;
  tagIds: number[];
  tagNames: string[];
};

export const snapshotRelease = (release: {
  title: string;
  description: string;
  image: string | null;
  year: number;
  releaseTags: Array<{ tag: { id: number; name: string } }>;
}): ReleaseSnapshot => ({
  title: release.title,
  description: release.description,
  image: release.image ?? null,
  year: release.year,
  tagIds: release.releaseTags.map((tag) => tag.tag.id).sort((a, b) => a - b),
  tagNames: release.releaseTags.map((tag) => tag.tag.name).sort()
});

export const changedReleaseFields = (
  before: ReleaseSnapshot,
  after: ReleaseSnapshot
): string[] => {
  const changed: string[] = [];
  if (before.title !== after.title) changed.push('title');
  if (before.description !== after.description) changed.push('description');
  if (before.image !== after.image) changed.push('image');
  if (before.year !== after.year) changed.push('year');
  if (JSON.stringify(before.tagIds) !== JSON.stringify(after.tagIds)) {
    changed.push('tags');
  }
  return changed;
};

export const summarizeReleaseChanges = (fields: string[]): string => {
  if (fields.length === 0) return 'Release metadata updated';
  return `Updated ${fields.join(', ')}`;
};

export const extractRevisionSnapshot = (entry: {
  snapshot: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
}): ReleaseSnapshot | null => {
  const candidate = entry.snapshot ?? entry.after;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as unknown as ReleaseSnapshot;
};
