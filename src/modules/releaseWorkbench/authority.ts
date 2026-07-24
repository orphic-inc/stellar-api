import { prisma } from '../../lib/prisma';
import { getUserRankAccess } from '../../lib/userRankAccess';
import { assertCommunityAccess } from '../communityAccess';
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

export const loadReleaseWorkbenchAuthority = async (
  ref: ReleaseWorkbenchRef,
  options: { requireCommunityAccess?: boolean } = {}
): Promise<ReleaseWorkbenchAuthority> => {
  if (options.requireCommunityAccess ?? true) {
    await assertCommunityAccess(ref.communityId, ref.actorId);
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
