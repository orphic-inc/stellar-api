import { Prisma, NotificationType, SubscriptionPage } from '@prisma/client';
import { recipientsWhoCanSee } from '../modules/notificationAccess';

type TxClient = Prisma.TransactionClient;

export function extractMentionedUsernames(body: string): string[] {
  const matches = body.matchAll(/\[quote=([^\]]+)\]/gi);
  return [...new Set([...matches].map((m) => m[1].trim()))];
}

// Returns usernames present in newBody but not in currentBody (case-insensitive).
// Used for edit-path quote notifications to avoid re-notifying for existing quotes.
export function extractNewMentionedUsernames(
  currentBody: string,
  newBody: string
): string[] {
  const existing = new Set(
    extractMentionedUsernames(currentBody).map((u) => u.toLowerCase())
  );
  return extractMentionedUsernames(newBody).filter(
    (u) => !existing.has(u.toLowerCase())
  );
}

/**
 * Write one notification per recipient — only for recipients who can see the
 * target when it is sent (#695). Every emitter goes through here, so none can
 * notify a member about a private release, a forum above their class or a
 * community they are not in: the rule lives in `recipientsWhoCanSee`, once.
 *
 * Recipients are deduped first. `Notification` has no unique key, so
 * `skipDuplicates` cannot catch a member named twice — a subscriber to two
 * credited artists, say.
 */
export async function emitNotifications(
  tx: TxClient,
  opts: {
    userIds: number[];
    type: NotificationType;
    actorId?: number;
    page: SubscriptionPage;
    pageId: number;
    postId?: number;
  }
): Promise<void> {
  const named = [...new Set(opts.userIds)].filter((id) => id !== opts.actorId);
  const recipients = await recipientsWhoCanSee(
    tx,
    opts.page,
    opts.pageId,
    named
  );

  if (recipients.length === 0) return;

  await tx.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: opts.type,
      actorId: opts.actorId ?? null,
      page: opts.page,
      pageId: opts.pageId,
      postId: opts.postId ?? null
    })),
    skipDuplicates: true
  });
}
