import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { hasAnyPermission, hasPermission } from '../../lib/rankPermissions';
import { getUserRankAccess } from '../../lib/userRankAccess';
import { assertCommunityAccess } from '../communityAccess';
import { releasesUnderOpenReport } from '../reportedRelease';
import type { ReleaseWorkbenchRef } from './types';

export type ReleaseWorkbenchAuthority = {
  actorId: number;
  communityId: number;
  releaseId: number;
  canEditMetadata: boolean;
  canManageTags: boolean;
  /** Change or remove any credit; a credit's adder may change or remove their own (#721). */
  canManageCredits: boolean;
  canVote: boolean;
  canAttachContribution: boolean;
  canRevertHistory: boolean;
  /**
   * The read is let in only because an open report concerns the release
   * (ADR-0055 §3, #905). Every `can*` is then false: the grant is to look.
   */
  reportScoped: boolean;
};

/**
 * The community gate, with the one exception ADR-0055 §3 makes: a
 * `reports_manage` holder reads the page of a release an `Open` or `Claimed`
 * report concerns. True when only that exception lets the read in.
 *
 * Only a refusal for want of access (`403`) is excused. A missing community
 * stays `404`, and a release outside the reported set keeps the same `403` a
 * member gets, so the exception confirms nothing a report does not already say.
 */
const passCommunityGate = async (
  ref: ReleaseWorkbenchRef,
  allowReportScoped: boolean
): Promise<boolean> => {
  try {
    await assertCommunityAccess(ref.communityId, ref.actorId);
    return false;
  } catch (err) {
    if (!allowReportScoped || !(err instanceof AppError)) throw err;
    if (err.statusCode !== 403) throw err;
    const permissions =
      ref.permissions ?? (await getUserRankAccess(ref.actorId))?.permissions;
    if (!hasPermission(permissions, 'reports_manage')) throw err;
    if (!(await releasesUnderOpenReport([ref.releaseId])).has(ref.releaseId)) {
      throw err;
    }
    return true;
  }
};

export const loadReleaseWorkbenchAuthority = async (
  ref: ReleaseWorkbenchRef,
  options: {
    requireCommunityAccess?: boolean;
    allowReportScoped?: boolean;
  } = {}
): Promise<ReleaseWorkbenchAuthority> => {
  const reportScoped =
    (options.requireCommunityAccess ?? true) &&
    (await passCommunityGate(ref, options.allowReportScoped ?? false));

  const [access, contribution] = await Promise.all([
    ref.permissions ? Promise.resolve(null) : getUserRankAccess(ref.actorId),
    prisma.contribution.findFirst({
      where: { releaseId: ref.releaseId, userId: ref.actorId },
      select: { id: true }
    })
  ]);

  // `hasPermission` counts `admin` as every permission.
  const permissions = ref.permissions ?? access?.permissions;
  const canModerateRelease = hasAnyPermission(permissions, [
    'communities_manage',
    'staff'
  ]);
  const canManageTags =
    !reportScoped && hasPermission(permissions, 'communities_manage');
  const isContributor = !!contribution;

  return {
    actorId: ref.actorId,
    communityId: ref.communityId,
    releaseId: ref.releaseId,
    canEditMetadata: !reportScoped && (canModerateRelease || isContributor),
    canManageTags,
    canManageCredits: canManageTags,
    canVote: !reportScoped,
    canAttachContribution: !reportScoped,
    canRevertHistory: canManageTags,
    reportScoped
  };
};
