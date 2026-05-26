import { Prisma, NotificationType, SubscriptionPage } from '@prisma/client';

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
  const recipients = opts.actorId
    ? opts.userIds.filter((id) => id !== opts.actorId)
    : opts.userIds;

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
