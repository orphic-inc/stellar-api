import { FileType, ReleaseHistoryAction } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { emitNotifications } from '../../lib/notifications';
import { addContributionToRelease } from '../contribution';
import { getSettings } from '../settings';
import { loadReleaseWorkbenchAuthority } from './authority';
import { snapshotRelease } from './snapshot';
import type { ReleaseContributionView, ReleaseWorkbenchRef } from './types';
import type { AddContributionToReleaseInput } from '../../schemas/contribution';

export const attachReleaseWorkbenchContribution = async (
  ref: ReleaseWorkbenchRef,
  input: AddContributionToReleaseInput
): Promise<ReleaseContributionView> => {
  const authority = await loadReleaseWorkbenchAuthority(ref, {
    requireCommunityAccess: false
  });
  if (!authority.canAttachContribution) {
    throw new AppError(403, 'Not authorized');
  }

  const settings = await getSettings();
  if (settings.approvedDomains.length > 0) {
    let host: string;
    try {
      host = new URL(input.downloadUrl).hostname;
    } catch {
      throw new AppError(400, 'Invalid download URL');
    }
    if (!settings.approvedDomains.includes(host)) {
      throw new AppError(
        400,
        `Domain '${host}' is not in the approved domains list`
      );
    }
  }

  const community = await prisma.community.findUnique({
    where: { id: ref.communityId },
    select: { allowDuplicateFormats: true }
  });
  if (!community) {
    throw new AppError(404, 'Community not found');
  }

  if (!community.allowDuplicateFormats) {
    const existing = await prisma.contribution.findFirst({
      where: { releaseId: ref.releaseId, type: input.fileType as FileType }
    });
    if (existing) {
      throw new AppError(
        409,
        `A ${input.fileType} contribution already exists for this release`
      );
    }
  }

  const contribution = await addContributionToRelease({
    userId: ref.actorId,
    communityId: ref.communityId,
    releaseId: ref.releaseId,
    input
  });
  if (!contribution) {
    throw new AppError(404, 'Release not found');
  }

  await prisma.$transaction(async (tx) => {
    const credits = await tx.releaseArtist.findMany({
      where: { releaseId: contribution.release.id },
      select: { artistId: true }
    });
    const subs = await tx.artistSubscription.findMany({
      where: { artistId: { in: credits.map((credit) => credit.artistId) } },
      select: { userId: true }
    });
    if (subs.length > 0) {
      await emitNotifications(tx, {
        userIds: subs.map((s) => s.userId),
        type: 'artist_release',
        actorId: ref.actorId,
        page: 'contributions',
        pageId: contribution.id
      });
    }
    const releaseWithTags = await tx.release.findUniqueOrThrow({
      where: { id: contribution.release.id },
      include: { releaseTags: { include: { tag: true } } }
    });
    await tx.releaseHistory.create({
      data: {
        releaseId: contribution.release.id,
        actorId: ref.actorId,
        action: ReleaseHistoryAction.contribution_added,
        summary: `${contribution.type} contribution added`,
        changedFields: [],
        after: {
          contributionId: contribution.id,
          type: contribution.type,
          sizeInBytes: contribution.sizeInBytes ?? null,
          contributor: contribution.user?.username ?? null
        } as never,
        snapshot: snapshotRelease(releaseWithTags) as never
      }
    });
  });

  return contribution as ReleaseContributionView;
};
