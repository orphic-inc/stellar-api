/**
 * Staff invite controls (#636): revoke or restore one member's invite
 * privileges, set their invite count, and cancel a pending invite from the
 * pool. All sit behind `invites_edit`.
 *
 * Four things here are deliberate and not obvious from the issue:
 *
 *  - Setting the count is a COMPARE-AND-SET. Every other `inviteCount` writer
 *    (the send, the handout, the #627 refund) writes relative to the current
 *    value, so none can clobber another. An absolute staff write would be the
 *    first that can, silently erasing a refund that landed while the form was
 *    open. The caller's `expectedInviteCount` makes the write a claim instead,
 *    and a stale one answers 409.
 *  - Revoking keeps the balance. It is inert while revoked (the send refuses,
 *    the handout skips, pending invites lapse) and back the moment staff
 *    restore. Zeroing it is a separate, deliberate count edit.
 *  - `reason` is for staff and lives in the audit row; `message` is for the
 *    member and is sent as a System PM after the write commits, so a failed PM
 *    cannot undo the change. The two are different texts on purpose, and the
 *    message is not copied into the audit row.
 *  - A cancel always refunds. ADR-0041's rule generalises: an invite that leaves
 *    `pending` without being accepted returns to its inviter, whoever ended it.
 *    Like the sweep's, the refund belongs to the `pending → cancelled` claim, so
 *    exactly one of cancel, expiry or acceptance wins and pays at most once.
 */
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { AppError } from '../lib/errors';
import { getLogger } from './logging';
import { site } from './config';
import { sendSystemMessage } from './pm';

const log = getLogger('inviteControls');

/**
 * The highest count staff can set. A typo guard, not a policy: it is not tied
 * to `inviteCap`, which bounds accrual rather than holdings (ADR-0041). It also
 * keeps refunds far from the `Int` column's ceiling.
 */
export const STAFF_INVITE_COUNT_MAX = 1000;

const USER_NOT_FOUND = 'User not found';
const COUNT_CHANGED =
  "This member's invite count changed since you loaded it. Reload and try again.";

const withStaffPmPointer = (message: string) =>
  `${message}\n\nIf you have questions, contact staff through Staff PM: ${site.staffPmPath}`;

/** Tell the member. Never throws: the change it describes has committed. */
const notifyMember = async (
  userId: number,
  subject: string,
  body: string
): Promise<void> => {
  await sendSystemMessage(userId, subject, body).catch((err) =>
    log.error('Invite control PM failed', { userId, err })
  );
};

export interface SetCanInviteInput {
  canInvite: boolean;
  reason: string;
  message?: string;
}

/**
 * Idempotent, like the rank lock: writing the value a member already has still
 * succeeds and still audits.
 */
export const setCanInvite = async (
  actorId: number,
  userId: number,
  { canInvite, reason, message }: SetCanInviteInput
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: userId },
      data: { canInvite }
    });
    if (count === 0) throw new AppError(404, USER_NOT_FOUND);

    const { inviteCount } = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { inviteCount: true }
    });
    await audit(tx, actorId, 'user.can_invite_changed', 'User', userId, {
      canInvite,
      reason,
      inviteCount,
      messaged: message !== undefined
    });
  });

  if (message !== undefined) {
    const subject = canInvite
      ? 'Your invite privileges have been restored'
      : 'Your invite privileges have been revoked';
    await notifyMember(userId, subject, withStaffPmPointer(message));
  }
};

export interface SetInviteCountInput {
  inviteCount: number;
  expectedInviteCount: number;
  reason: string;
  message?: string;
}

export const setInviteCount = async (
  actorId: number,
  userId: number,
  { inviteCount, expectedInviteCount, reason, message }: SetInviteCountInput
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: userId, inviteCount: expectedInviteCount },
      data: { inviteCount }
    });
    if (count === 0) {
      const exists = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true }
      });
      throw exists
        ? new AppError(409, COUNT_CHANGED)
        : new AppError(404, USER_NOT_FOUND);
    }

    await audit(tx, actorId, 'user.invite_count_changed', 'User', userId, {
      from: expectedInviteCount,
      to: inviteCount,
      reason,
      messaged: message !== undefined
    });
  });

  // The new balance only: the previous one stays in the staff audit row.
  if (message !== undefined) {
    await notifyMember(
      userId,
      'Your invite count was changed',
      withStaffPmPointer(
        `${message}\n\nYou now have ${inviteCount} ${inviteCount === 1 ? 'invite' : 'invites'}.`
      )
    );
  }
};

export interface CancelInviteInput {
  reason: string;
  message?: string;
}

const INVITE_NOT_FOUND = 'Invite not found';
const INVITE_NOT_PENDING = 'This invite is no longer pending';

/**
 * Claim any `pending` row, including one past `expires` that the sweep has not
 * reached yet: the stored status then records the staff act, and the refund is
 * still paid once, because the sweep's claim also requires `pending`.
 */
export const cancelInvite = async (
  actorId: number,
  inviteId: number,
  { reason, message }: CancelInviteInput
): Promise<void> => {
  const invite = await prisma.$transaction(async (tx) => {
    const { count } = await tx.invite.updateMany({
      where: { id: inviteId, status: 'pending' },
      data: { status: 'cancelled' }
    });
    if (count === 0) {
      const exists = await tx.invite.findUnique({
        where: { id: inviteId },
        select: { id: true }
      });
      throw exists
        ? new AppError(409, INVITE_NOT_PENDING)
        : new AppError(404, INVITE_NOT_FOUND);
    }

    const cancelled = await tx.invite.findUniqueOrThrow({
      where: { id: inviteId },
      select: { inviterId: true, email: true }
    });
    await tx.user.update({
      where: { id: cancelled.inviterId },
      data: { inviteCount: { increment: 1 } }
    });
    await audit(tx, actorId, 'invite.cancelled', 'Invite', inviteId, {
      by: 'staff',
      inviterId: cancelled.inviterId,
      email: cancelled.email,
      refunded: true,
      reason,
      messaged: message !== undefined
    });
    return cancelled;
  });

  if (message !== undefined) {
    await notifyMember(
      invite.inviterId,
      'An invite you sent was cancelled',
      withStaffPmPointer(
        `${message}\n\nYour invite to ${invite.email} has been returned to you.`
      )
    );
  }
};
