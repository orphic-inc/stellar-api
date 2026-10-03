import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { AppError } from '../lib/errors';
import { disableAccounts } from './accountDisable';
import { getInviteSubtreeEdges } from './inviteSubtreeWalk';
import type {
  InviteSubtreeAction,
  InviteSubtreeActionInput
} from '../schemas/inviteSubtree';

/**
 * Staff actions on a member's whole invite subtree (#639): a note, a disable,
 * or revoking invite privileges, applied to every descendant. The root member
 * is never included.
 *
 * Staff preview the subtree first. The apply names the count the preview
 * showed and is refused if the tree has changed since, so nothing is applied
 * that staff did not see. There is no count cap and no bulk undo; the run's
 * audit row keeps the ids it changed. Affected members are not messaged.
 */

const memberSelect = {
  id: true,
  username: true,
  disabled: true,
  canInvite: true,
  inviteCount: true
} as const;

type Member = Prisma.UserGetPayload<{ select: typeof memberSelect }> & {
  depth: number;
};

const ACTION_LABELS: Record<InviteSubtreeAction, string> = {
  note: 'note only',
  disable: 'disable',
  revoke_invites: 'revoke invite privileges'
};

const findRoot = async (client: Prisma.TransactionClient, id: number) => {
  const root = await client.user.findUnique({
    where: { id },
    select: { id: true, username: true }
  });
  if (!root) throw new AppError(404, 'User not found');
  return root;
};

const loadMembers = async (
  client: Prisma.TransactionClient,
  rootUserId: number
): Promise<Member[]> => {
  const edges = await getInviteSubtreeEdges(rootUserId, client);
  const depthOf = new Map(edges.map((e) => [e.userId, e.depth]));
  const users = await client.user.findMany({
    where: { id: { in: [...depthOf.keys()] } },
    select: memberSelect
  });
  return users
    .map((u) => ({ ...u, depth: depthOf.get(u.id) ?? 1 }))
    .sort((a, b) => a.depth - b.depth || a.id - b.id);
};

export const previewInviteSubtree = async (rootUserId: number) => {
  await findRoot(prisma, rootUserId);
  const members = await loadMembers(prisma, rootUserId);
  return {
    rootUserId,
    count: members.length,
    disabled: members.filter((m) => m.disabled).length,
    withoutInvites: members.filter((m) => !m.canInvite).length,
    members: members.map(({ id, username, depth, disabled, canInvite }) => ({
      id,
      username,
      depth,
      disabled,
      canInvite
    }))
  };
};

/**
 * Revoke invite privileges from every member who still has them, auditing
 * each exactly as `setCanInvite` does for one member (#636).
 */
const revokeInvites = async (
  tx: Prisma.TransactionClient,
  actorId: number,
  members: Member[],
  reason: string,
  subtreeRootId: number
): Promise<number[]> => {
  const targets = members.filter((m) => m.canInvite);
  if (targets.length === 0) return [];
  await tx.user.updateMany({
    where: { id: { in: targets.map((m) => m.id) } },
    data: { canInvite: false }
  });
  for (const m of targets) {
    await audit(tx, actorId, 'user.can_invite_changed', 'User', m.id, {
      canInvite: false,
      reason,
      inviteCount: m.inviteCount,
      messaged: false,
      subtreeRootId
    });
  }
  return targets.map((m) => m.id);
};

/** Apply the action and return the ids it changed. */
const applyAction = async (
  tx: Prisma.TransactionClient,
  actorId: number,
  members: Member[],
  { action, reason }: InviteSubtreeActionInput,
  subtreeRootId: number
): Promise<number[]> => {
  if (action === 'disable') {
    const ids = members.filter((m) => !m.disabled).map((m) => m.id);
    await disableAccounts(tx, actorId, ids, { subtreeRootId });
    return ids;
  }
  if (action === 'revoke_invites') {
    return revokeInvites(tx, actorId, members, reason, subtreeRootId);
  }
  return members.map((m) => m.id);
};

export const applyInviteSubtreeAction = async (
  actorId: number,
  rootUserId: number,
  input: InviteSubtreeActionInput
) =>
  prisma.$transaction(async (tx) => {
    const root = await findRoot(tx, rootUserId);
    const members = await loadMembers(tx, rootUserId);
    if (members.length !== input.expectedCount) {
      throw new AppError(
        409,
        `This invite tree now has ${members.length} members, not ${input.expectedCount}. Preview it again.`
      );
    }

    const body = `Invite tree action (${ACTION_LABELS[input.action]}) on every member invited under ${root.username} (#${root.id}):\n${input.reason}`;
    await tx.userModerationNote.createMany({
      data: members.map((m) => ({ userId: m.id, authorId: actorId, body }))
    });
    const changed = await applyAction(tx, actorId, members, input, root.id);
    await audit(tx, actorId, 'user.invite_subtree_action', 'User', root.id, {
      action: input.action,
      reason: input.reason,
      count: members.length,
      userIds: changed
    });

    return {
      action: input.action,
      count: members.length,
      changed: changed.length,
      unchanged: members.length - changed.length
    };
  });
