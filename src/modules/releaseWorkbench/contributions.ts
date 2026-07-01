import { FileType, ReleaseHistoryAction } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { sizeBytesToNumber } from '../../lib/serialize';
import { AppError } from '../../lib/errors';
import { emitNotifications } from '../../lib/notifications';
import { addContributionToRelease } from '../contribution';
import { getSettings } from '../settings';
import { loadReleaseWorkbenchAuthority } from './authority';
import { snapshotRelease } from './snapshot';
import type {
  ReleaseContributionDetailView,
  ReleaseContributionView,
  ReleaseWorkbenchRef
} from './types';
import type { AddContributionToReleaseInput } from '../../schemas/contribution';

// The rip-quality satellite + full edition identity for one release's
// contributions. Kept off the release detail view (which is growing heavy) and
// served from its own release-scoped GET so the UI can lazy-load an edition
// stack (bitrate/media/flags) on demand. Gated identically to the detail read.
export const listReleaseContributions = async (
  ref: ReleaseWorkbenchRef
): Promise<ReleaseContributionDetailView[]> => {
  await loadReleaseWorkbenchAuthority(ref);

  // 404 rather than an empty 200 when the named release isn't in this community —
  // matches the sibling detail GET and the attach POST.
  const release = await prisma.release.findFirst({
    where: { id: ref.releaseId, communityId: ref.communityId },
    select: { id: true }
  });
  if (!release) {
    throw new AppError(404, 'Release not found');
  }

  const contributions = await prisma.contribution.findMany({
    where: {
      releaseId: ref.releaseId,
      release: { communityId: ref.communityId }
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      userId: true,
      releaseId: true,
      contributorId: true,
      releaseDescription: true,
      downloadUrl: true,
      sizeInBytes: true,
      linkStatus: true,
      linkCheckedAt: true,
      type: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, username: true } },
      collaborators: { select: { id: true, name: true } },
      releaseFile: {
        select: { bitrate: true, hasLog: true, hasCue: true, isScene: true }
      },
      edition: {
        select: {
          id: true,
          media: true,
          year: true,
          recordLabel: true,
          catalogueNumber: true,
          title: true,
          isRemaster: true,
          isUnknownEdition: true
        }
      }
    }
  });

  return contributions.map((contribution) => ({
    ...contribution,
    sizeInBytes: sizeBytesToNumber(contribution.sizeInBytes)
  }));
};

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
          sizeInBytes: sizeBytesToNumber(contribution.sizeInBytes),
          contributor: contribution.user?.username ?? null
        } as never,
        snapshot: snapshotRelease(releaseWithTags) as never
      }
    });
  });

  return contribution as ReleaseContributionView;
};
