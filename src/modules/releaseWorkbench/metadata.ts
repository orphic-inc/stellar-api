import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { loadReleaseWorkbenchAuthority } from './authority';
import { getReleaseWorkbenchView } from './load';
import {
  changedReleaseFields,
  snapshotRelease,
  summarizeReleaseChanges
} from './snapshot';
import type {
  ReleaseWorkbenchRef,
  ReleaseWorkbenchView,
  UpdateReleaseMetadataInput
} from './types';
import { ReleaseHistoryAction } from '@prisma/client';

export const updateReleaseWorkbenchMetadata = async (
  ref: ReleaseWorkbenchRef,
  input: UpdateReleaseMetadataInput
): Promise<ReleaseWorkbenchView> => {
  const existing = await prisma.release.findFirst({
    where: { id: ref.releaseId, communityId: ref.communityId },
    include: {
      releaseTags: { include: { tag: { select: { id: true, name: true } } } }
    }
  });
  if (!existing) {
    throw new AppError(404, 'Release not found');
  }

  const authority = await loadReleaseWorkbenchAuthority(ref, {
    requireCommunityAccess: false
  });
  if (!authority.canEditMetadata) {
    throw new AppError(
      403,
      'Must be a contributor or staff to edit this release'
    );
  }

  const before = snapshotRelease(existing);

  await prisma.$transaction(async (tx) => {
    await tx.release.update({
      where: { id: ref.releaseId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && {
          description: input.description
        }),
        ...(input.image !== undefined && { image: input.image }),
        ...(input.year !== undefined && { year: input.year })
      }
    });

    const refreshed = await tx.release.findUniqueOrThrow({
      where: { id: ref.releaseId },
      include: { releaseTags: { include: { tag: true } } }
    });

    const after = snapshotRelease(refreshed);
    const changedFields = changedReleaseFields(before, after).filter(
      (field) => field !== 'tags'
    );

    if (changedFields.length > 0) {
      await tx.releaseHistory.create({
        data: {
          releaseId: ref.releaseId,
          actorId: ref.actorId,
          action: ReleaseHistoryAction.edit,
          summary:
            input.editSummary?.trim() || summarizeReleaseChanges(changedFields),
          changedFields,
          before: before as never,
          after: after as never,
          snapshot: after as never
        }
      });
    }
  });

  return getReleaseWorkbenchView(ref, { requireCommunityAccess: false });
};
