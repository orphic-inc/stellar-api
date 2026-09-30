import { prisma } from '../lib/prisma';
import { hasPermission } from '../lib/rankPermissions';

export type ViewerContext = {
  viewerId: number | null;
  isOwner: boolean;
  isStaff: boolean;
  // Who invited this member: `invites_manage` only, the owner included (#849).
  canSeeInviter: boolean;
};

const ANONYMOUS: ViewerContext = {
  viewerId: null,
  isOwner: false,
  isStaff: false,
  canSeeInviter: false
};

export const loadViewerContext = async (
  targetUserId: number,
  viewerUserId?: number
): Promise<ViewerContext> => {
  if (!viewerUserId) return ANONYMOUS;

  const viewer = await prisma.user.findUnique({
    where: { id: viewerUserId },
    select: {
      userRank: { select: { permissions: true } }
    }
  });
  const perms = (viewer?.userRank.permissions ?? {}) as Record<string, boolean>;
  const canSeeInviter = hasPermission(perms, 'invites_manage');

  if (viewerUserId === targetUserId) {
    return {
      viewerId: viewerUserId,
      isOwner: true,
      isStaff: false,
      canSeeInviter
    };
  }

  const isStaff = !!(
    perms.staff ||
    perms.admin ||
    perms.users_edit ||
    perms.users_warn ||
    perms.users_disable
  );

  return { viewerId: viewerUserId, isOwner: false, isStaff, canSeeInviter };
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
