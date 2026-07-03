import { prisma } from '../lib/prisma';
import {
  authorRefSelect,
  toAuthorRefOrNull,
  type AuthorRefRow
} from './authorRef';

const PAGE_SIZE = 25;

const senderSelect = authorRefSelect;

// Shapes the sender/participant relations a PM conversation carries so the
// donor sign + warning sign follow the sender everywhere a message renders
// (#231), not just on their profile.
const mapMessage = <T extends { sender: AuthorRefRow | null }>(message: T) => ({
  ...message,
  sender: toAuthorRefOrNull(message.sender)
});

type ParticipantRow = { user?: AuthorRefRow } & Record<string, unknown>;

const mapConversation = <
  T extends {
    messages?: Array<{ sender: AuthorRefRow | null } & Record<string, unknown>>;
    participants?: Array<ParticipantRow>;
  }
>(
  conversation: T
) => ({
  ...conversation,
  ...(conversation.messages && {
    messages: conversation.messages.map(mapMessage)
  }),
  ...(conversation.participants && {
    participants: conversation.participants.map((p) =>
      'user' in p ? { ...p, user: toAuthorRefOrNull(p.user) } : p
    )
  })
});

export async function listInbox(userId: number, page: number, search?: string) {
  const where = {
    participants: {
      some: { userId, inInbox: true }
    },
    ...(search
      ? { subject: { contains: search, mode: 'insensitive' as const } }
      : {})
  };

  const [total, conversations] = await Promise.all([
    prisma.privateConversation.count({ where }),
    prisma.privateConversation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        participants: {
          where: { userId },
          select: {
            isRead: true,
            isSticky: true,
            receivedAt: true,
            sentAt: true
          }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { sender: { select: senderSelect } }
        }
      }
    })
  ]);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    conversations: conversations.map(mapConversation)
  };
}

export async function listSentbox(userId: number, page: number) {
  const where = {
    participants: { some: { userId, inSentbox: true } }
  };

  const [total, conversations] = await Promise.all([
    prisma.privateConversation.count({ where }),
    prisma.privateConversation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        participants: {
          where: { userId },
          select: { isRead: true, sentAt: true }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { sender: { select: senderSelect } }
        }
      }
    })
  ]);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    conversations: conversations.map(mapConversation)
  };
}

export async function getUnreadCount(userId: number): Promise<number> {
  return prisma.privateConversation.count({
    where: {
      participants: { some: { userId, inInbox: true, isRead: false } }
    }
  });
}

export async function sendMessage(
  fromId: number,
  toId: number,
  subject: string,
  body: string
) {
  if (fromId === toId) return { ok: false as const, reason: 'self_message' };

  const recipient = await prisma.user.findUnique({
    where: { id: toId },
    select: { id: true, disabled: true, disablePm: true }
  });
  if (!recipient) return { ok: false as const, reason: 'recipient_not_found' };
  if (recipient.disabled)
    return { ok: false as const, reason: 'recipient_disabled' };
  if (recipient.disablePm)
    return { ok: false as const, reason: 'recipient_pm_disabled' };

  const conversation = await prisma.$transaction(async (tx) => {
    const conv = await tx.privateConversation.create({
      data: {
        subject,
        messages: {
          create: { senderId: fromId, body }
        },
        participants: {
          create: [
            {
              userId: toId,
              inInbox: true,
              inSentbox: false,
              isRead: false,
              receivedAt: new Date()
            },
            {
              userId: fromId,
              inInbox: false,
              inSentbox: true,
              isRead: true,
              sentAt: new Date()
            }
          ]
        }
      },
      include: {
        messages: { include: { sender: { select: senderSelect } } },
        participants: true
      }
    });
    return conv;
  });

  return { ok: true as const, conversation: mapConversation(conversation) };
}

/**
 * Send a one-way "System" private message: a conversation with the recipient as
 * the sole participant and a message whose senderId is null. A null sender has
 * no profile to click and no inbox to reply into, so the UI renders it as an
 * unclickable, no-reply "System" notice. Used for operational notices (e.g. a
 * contribution link going dead, #125) rather than user-to-user mail, so it
 * bypasses the recipient's disablePm preference — but still skips disabled
 * accounts, which can receive nothing.
 */
export async function sendSystemMessage(
  toId: number,
  subject: string,
  body: string
) {
  const recipient = await prisma.user.findUnique({
    where: { id: toId },
    select: { id: true, disabled: true }
  });
  if (!recipient) return { ok: false as const, reason: 'recipient_not_found' };
  if (recipient.disabled)
    return { ok: false as const, reason: 'recipient_disabled' };

  const conversation = await prisma.privateConversation.create({
    data: {
      subject,
      messages: { create: { senderId: null, body } },
      participants: {
        create: {
          userId: toId,
          inInbox: true,
          inSentbox: false,
          isRead: false,
          receivedAt: new Date()
        }
      }
    },
    include: {
      messages: { include: { sender: { select: senderSelect } } },
      participants: true
    }
  });

  return { ok: true as const, conversation: mapConversation(conversation) };
}

export async function replyToConversation(
  conversationId: number,
  senderId: number,
  body: string
) {
  const participant = await prisma.privateConversationParticipant.findFirst({
    where: {
      conversationId,
      userId: senderId,
      OR: [{ inInbox: true }, { inSentbox: true }]
    }
  });
  if (!participant) return { ok: false as const, reason: 'not_participant' };

  const allParticipants = await prisma.privateConversationParticipant.findMany({
    where: { conversationId }
  });

  const message = await prisma.$transaction(async (tx) => {
    const msg = await tx.privateMessage.create({
      data: { conversationId, senderId, body },
      include: { sender: { select: senderSelect } }
    });

    for (const p of allParticipants) {
      if (p.userId === senderId) {
        await tx.privateConversationParticipant.update({
          where: {
            userId_conversationId: { userId: p.userId, conversationId }
          },
          data: { inSentbox: true, isRead: true, sentAt: new Date() }
        });
      } else {
        await tx.privateConversationParticipant.update({
          where: {
            userId_conversationId: { userId: p.userId, conversationId }
          },
          data: { inInbox: true, isRead: false, receivedAt: new Date() }
        });
      }
    }

    return msg;
  });

  return { ok: true as const, message: mapMessage(message) };
}

export async function viewConversation(conversationId: number, userId: number) {
  const conversation = await prisma.privateConversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { sender: { select: senderSelect } }
      },
      participants: {
        include: { user: { select: senderSelect } }
      }
    }
  });
  if (!conversation) return { ok: false as const, reason: 'not_found' };

  const participant = conversation.participants.find(
    (p) => p.userId === userId && (p.inInbox || p.inSentbox)
  );
  if (!participant) return { ok: false as const, reason: 'not_found' };

  if (!participant.isRead) {
    await prisma.privateConversationParticipant.update({
      where: { userId_conversationId: { userId, conversationId } },
      data: { isRead: true }
    });
  }

  return { ok: true as const, conversation: mapConversation(conversation) };
}

export async function updateConversationFlags(
  conversationId: number,
  userId: number,
  flags: { isSticky?: boolean; isRead?: boolean }
) {
  const participant = await prisma.privateConversationParticipant.findFirst({
    where: {
      conversationId,
      userId,
      OR: [{ inInbox: true }, { inSentbox: true }]
    }
  });
  if (!participant) return { ok: false as const, reason: 'not_found' };

  await prisma.privateConversationParticipant.update({
    where: { userId_conversationId: { userId, conversationId } },
    data: flags
  });

  return { ok: true as const };
}

export async function deleteConversation(
  conversationId: number,
  userId: number
) {
  const participant = await prisma.privateConversationParticipant.findFirst({
    where: { conversationId, userId }
  });
  if (!participant) return { ok: false as const, reason: 'not_found' };

  await prisma.privateConversationParticipant.update({
    where: { userId_conversationId: { userId, conversationId } },
    data: { inInbox: false, inSentbox: false, isSticky: false }
  });

  return { ok: true as const };
}

export async function bulkUpdateConversations(
  userId: number,
  ids: number[],
  action: 'delete' | 'markRead' | 'markUnread'
) {
  const dataMap = {
    delete: { inInbox: false, inSentbox: false, isSticky: false },
    markRead: { isRead: true },
    markUnread: { isRead: false }
  };

  await prisma.privateConversationParticipant.updateMany({
    where: {
      userId,
      conversationId: { in: ids },
      OR: [{ inInbox: true }, { inSentbox: true }]
    },
    data: dataMap[action]
  });

  return { ok: true as const };
}
