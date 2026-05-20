import { Prisma, NotificationType, SubscriptionPage } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

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
