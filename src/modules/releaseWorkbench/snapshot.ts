import type { Prisma } from '@prisma/client';

export type ReleaseSnapshot = {
  title: string;
  description: string;
  image: string | null;
  year: number;
  isEdition: boolean;
  edition: unknown;
  tagIds: number[];
  tagNames: string[];
};

export const snapshotRelease = (release: {
  title: string;
  description: string;
  image: string | null;
  year: number;
  isEdition: boolean;
  edition: unknown;
  releaseTags: Array<{ tag: { id: number; name: string } }>;
}): ReleaseSnapshot => ({
  title: release.title,
  description: release.description,
  image: release.image ?? null,
  year: release.year,
  isEdition: release.isEdition,
  edition: release.edition ?? null,
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
  if (before.isEdition !== after.isEdition) changed.push('isEdition');
  if (JSON.stringify(before.edition) !== JSON.stringify(after.edition)) {
    changed.push('edition');
  }
  if (JSON.stringify(before.tagIds) !== JSON.stringify(after.tagIds)) {
    changed.push('tags');
  }
  return changed;
};

export const summarizeReleaseChanges = (fields: string[]): string => {
  if (fields.length === 0) return 'Release metadata updated';
  const labels = fields.map((field) => {
    switch (field) {
      case 'isEdition':
        return 'edition flag';
      default:
        return field;
    }
  });
  return `Updated ${labels.join(', ')}`;
};

export const extractRevisionSnapshot = (entry: {
  snapshot: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
}): ReleaseSnapshot | null => {
  const candidate = entry.snapshot ?? entry.after;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as unknown as ReleaseSnapshot;
};
