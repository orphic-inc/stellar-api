import { RegistrationStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { getUserRankAccess } from '../../lib/userRankAccess';
import type { ReleaseWorkbenchRef } from './types';

export type ReleaseWorkbenchAuthority = {
  actorId: number;
  communityId: number;
  releaseId: number;
  canEditMetadata: boolean;
  canManageTags: boolean;
  canVote: boolean;
  canAttachContribution: boolean;
  canRevertHistory: boolean;
};

const isCommunityMember = async (
  communityId: number,
  userId: number,
  registrationStatus: RegistrationStatus
): Promise<boolean> => {
  if (registrationStatus === RegistrationStatus.open) return true;
  const [consumer, contributor] = await Promise.all([
    prisma.consumer.findFirst({
      where: { userId, communities: { some: { id: communityId } } }
    }),
    prisma.contributor.findFirst({ where: { userId, communityId } })
  ]);
  return !!(consumer || contributor);
};

const getAccessibleCommunity = async (
  communityId: number,
  userId: number
): Promise<{ registrationStatus: RegistrationStatus }> => {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { registrationStatus: true }
  });
  if (!community) {
    throw new AppError(404, 'Community not found');
  }

  const isMember = await isCommunityMember(
    communityId,
    userId,
    community.registrationStatus
  );
  if (!isMember) {
    throw new AppError(403, 'Not a member of this community');
  }

  return community;
};

export const loadReleaseWorkbenchAuthority = async (
  ref: ReleaseWorkbenchRef,
  options: { requireCommunityAccess?: boolean } = {}
): Promise<ReleaseWorkbenchAuthority> => {
  if (options.requireCommunityAccess ?? true) {
    await getAccessibleCommunity(ref.communityId, ref.actorId);
  }

  const [access, contribution] = await Promise.all([
    ref.permissions ? Promise.resolve(null) : getUserRankAccess(ref.actorId),
    prisma.contribution.findFirst({
      where: { releaseId: ref.releaseId, userId: ref.actorId },
      select: { id: true }
    })
  ]);

  const permissions = ref.permissions ?? access?.permissions ?? {};
  const canModerateRelease =
    !!permissions['communities_manage'] ||
    !!permissions['admin'] ||
    !!permissions['staff'];
  const canManageTags =
    !!permissions['communities_manage'] || !!permissions['admin'];
  const isContributor = !!contribution;

  return {
    actorId: ref.actorId,
    communityId: ref.communityId,
    releaseId: ref.releaseId,
    canEditMetadata: canModerateRelease || isContributor,
    canManageTags,
    canVote: true,
    canAttachContribution: true,
    canRevertHistory: canManageTags
  };
};
