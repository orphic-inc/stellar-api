import { hasAnyPermission, hasPermission } from '../lib/rankPermissions';
import { getUserRankAccess } from '../lib/userRankAccess';
import { getProfileRatioViews } from './ratioPolicy';

export type ViewerContext = {
  viewerId: number | null;
  isOwner: boolean;
  isStaff: boolean;
  // Who invited this member: `invites_manage` only, the owner included (#849).
  canSeeInviter: boolean;
  // `inviteCount` and `canInvite`: the owner, staff, or either invite
  // permission, without the rest of what `isStaff` discloses (#655).
  canSeeInviteBalance: boolean;
  // The ratio policy status, `DOWNLOAD_DISABLED` included: `ratio_policy_manage`
  // only, the owner included (#658). The watch itself is any viewer's.
  canSeeRatioPolicy: boolean;
};

const ANONYMOUS: ViewerContext = {
  viewerId: null,
  isOwner: false,
  isStaff: false,
  canSeeInviter: false,
  canSeeInviteBalance: false,
  canSeeRatioPolicy: false
};

export const loadViewerContext = async (
  targetUserId: number,
  viewerUserId?: number
): Promise<ViewerContext> => {
  if (!viewerUserId) return ANONYMOUS;

  // Every rank the viewer holds, as `loadPermissions` resolves them (#855).
  const perms = (await getUserRankAccess(viewerUserId))?.permissions ?? {};
  const canSeeInviter = hasPermission(perms, 'invites_manage');
  const canSeeRatioPolicy = hasPermission(perms, 'ratio_policy_manage');

  if (viewerUserId === targetUserId) {
    return {
      viewerId: viewerUserId,
      isOwner: true,
      isStaff: false,
      canSeeInviter,
      canSeeInviteBalance: true,
      canSeeRatioPolicy
    };
  }

  const isStaff = hasAnyPermission(perms, [
    'staff',
    'users_edit',
    'users_warn',
    'users_disable'
  ]);

  const canSeeInviteBalance =
    isStaff || hasAnyPermission(perms, ['invites_manage', 'invites_edit']);

  return {
    viewerId: viewerUserId,
    isOwner: false,
    isStaff,
    canSeeInviter,
    canSeeInviteBalance,
    canSeeRatioPolicy
  };
};

type InviteEdge = {
  inviteTree: { inviter: { id: number; username: string } | null } | null;
};

/**
 * "Invited by" on the profile (#849). Null when the viewer may not see it; an
 * inner null inviter is "Nobody", as it is for a member no one invited.
 */
export const invitedByView = (user: InviteEdge, viewer: ViewerContext) =>
  viewer.canSeeInviter ? { inviter: user.inviteTree?.inviter ?? null } : null;

/** The profile fields each gated by its own viewer check, added to the view. */
export const withViewerFields = async <V extends object>(
  view: V,
  user: InviteEdge & { id: number; contributed: bigint; consumed: bigint },
  viewer: ViewerContext
) => ({
  ...view,
  invitedBy: invitedByView(user, viewer),
  ...(await getProfileRatioViews(user.id, user, viewer.canSeeRatioPolicy))
});
