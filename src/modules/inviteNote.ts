import type { Prisma } from '@prisma/client';
import { hasPermission } from '../lib/rankPermissions';
import { computeUserRankAccess } from '../lib/userRankAccess';

const RANK_SLICE = {
  select: { id: true, level: true, permissions: true, permittedForumIds: true }
} as const;

/** Whether the inviter holds `invites_note` now, across every rank they hold. */
const inviterMayNote = async (
  tx: Prisma.TransactionClient,
  inviterId: number
) => {
  const inviter = await tx.user.findUnique({
    where: { id: inviterId },
    select: {
      userRankId: true,
      userRank: RANK_SLICE,
      secondaryRanks: { select: { userRankId: true, userRank: RANK_SLICE } }
    }
  });
  return (
    inviter !== null &&
    hasPermission(computeUserRankAccess(inviter).permissions, 'invites_note')
  );
};

/**
 * The staff note on the invite this registration just claimed, as a nested
 * `moderationNotes` create for the new account (#851, grilled on #638).
 *
 * `Invite.email` is unique, so the claimed invite is the one on the new
 * account's address. The note is carried only if the inviter holds
 * `invites_note` at registration, not merely when they sent it. That keeps out
 * a note written before the permission existed, when any member could write
 * one, and a note from an inviter who has since lost it.
 */
export const carriedInviteNote = async (
  tx: Prisma.TransactionClient,
  account: { email: string; inviterId: number | null }
) => {
  const { inviterId } = account;
  if (inviterId === null) return undefined;
  const invite = await tx.invite.findUnique({
    where: { email: account.email.toLowerCase() },
    select: { reason: true, inviterId: true }
  });
  const body = invite?.inviterId === inviterId ? invite.reason.trim() : '';
  if (body === '' || !(await inviterMayNote(tx, inviterId))) return undefined;
  return { create: { authorId: inviterId, body: `Invite note: ${body}` } };
};
