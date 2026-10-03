import { Prisma } from '@prisma/client';
import { audit } from '../lib/audit';

/**
 * The staff disable write (#639): `POST /users/:id/disable` and an invite
 * subtree run both go through it, so they cannot drift apart. When #634
 * decides whether a staff disable also stamps `banDate`, this is the one place
 * that changes.
 *
 * It disables exactly the ids it is given and audits each one. The caller
 * decides which ids those are. Returns how many rows it wrote.
 */
export const disableAccounts = async (
  client: Prisma.TransactionClient,
  actorId: number,
  userIds: number[],
  metadata?: Record<string, unknown>
): Promise<number> => {
  if (userIds.length === 0) return 0;
  const { count } = await client.user.updateMany({
    where: { id: { in: userIds } },
    data: { disabled: true }
  });
  // Nothing matched: the single route's missing user, which it answers 404.
  if (count === 0) return 0;
  for (const id of userIds) {
    await audit(client, actorId, 'user.disabled', 'User', id, metadata);
  }
  return count;
};
