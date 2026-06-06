import { ReleaseHistoryAction } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { loadReleaseWorkbenchAuthority } from './authority';
import { getReleaseWorkbenchView } from './load';
import {
  changedReleaseFields,
  extractRevisionSnapshot,
  snapshotRelease
} from './snapshot';
import type { ReleaseWorkbenchRef, ReleaseWorkbenchView } from './types';

export const revertReleaseWorkbenchHistory = async (
  ref: ReleaseWorkbenchRef,
  input: { historyId: number }
): Promise<ReleaseWorkbenchView> => {
  const authority = await loadReleaseWorkbenchAuthority(ref);
  if (!authority.canRevertHistory) {
    throw new AppError(403, 'Permission denied');
  }

  const targetEntry = await prisma.releaseHistory.findFirst({
    where: { id: input.historyId, releaseId: ref.releaseId }
  });
  if (!targetEntry) {
    throw new AppError(404, 'History entry not found');
  }
  if (targetEntry.action !== ReleaseHistoryAction.edit) {
    throw new AppError(422, 'Only edit revisions can be reverted');
  }

  const restoreState = extractRevisionSnapshot(targetEntry);
  if (!restoreState) {
    throw new AppError(
      422,
      'History entry does not contain a restorable snapshot'
    );
  }

  const existing = await prisma.release.findFirst({
    where: { id: ref.releaseId, communityId: ref.communityId },
    include: { releaseTags: { include: { tag: true } } }
  });
  if (!existing) {
    throw new AppError(404, 'Release not found');
  }

  const currentSnapshot = snapshotRelease(existing);

  await prisma.$transaction(async (tx) => {
    await tx.release.update({
      where: { id: ref.releaseId },
      data: {
        title: restoreState.title,
        description: restoreState.description,
        image: restoreState.image,
        year: restoreState.year
      }
    });

    const changedFields = changedReleaseFields(
      currentSnapshot,
      restoreState
    ).filter((field) => field !== 'tags');

    await tx.releaseHistory.create({
      data: {
        releaseId: ref.releaseId,
        actorId: ref.actorId,
        action: ReleaseHistoryAction.edit,
        summary: `Reverted to revision from ${targetEntry.createdAt.toISOString()}`,
        changedFields,
        before: currentSnapshot as never,
        after: restoreState as never,
        snapshot: restoreState as never
      }
    });
  });

  return getReleaseWorkbenchView(ref);
};
