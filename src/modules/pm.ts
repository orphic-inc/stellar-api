import { prisma } from '../lib/prisma';
import type { StaffInboxStatus } from '@prisma/client';

const PAGE_SIZE = 25;

const senderSelect = {
  id: true,
  username: true,
  avatar: true
} as const;

export async function listInbox(userId: number, page: number, search?: string) {
  const where = {
    isStaffTicket: false,
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

  return { total, page, pageSize: PAGE_SIZE, conversations };
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

  return { total, page, pageSize: PAGE_SIZE, conversations };
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

  return { ok: true as const, conversation };
}

export async function replyToConversation(
  conversationId: number,
  senderId: number,
  body: string,
  isStaff = false
) {
  const conversation = await prisma.privateConversation.findUnique({
    where: { id: conversationId },
    select: { isStaffTicket: true, ticketStatus: true }
  });
  if (!conversation) return { ok: false as const, reason: 'not_participant' };

  // For tickets: owner or staff can reply
  if (conversation.isStaffTicket) {
    if (conversation.ticketStatus === 'Resolved') {
      return { ok: false as const, reason: 'not_participant' };
    }
    const participant = await prisma.privateConversationParticipant.findFirst({
      where: { conversationId, userId: senderId }
    });
    if (!isStaff && !participant)
      return { ok: false as const, reason: 'not_participant' };
  } else {
    const participant = await prisma.privateConversationParticipant.findFirst({
      where: {
        conversationId,
        userId: senderId,
        OR: [{ inInbox: true }, { inSentbox: true }]
      }
    });
    if (!participant) return { ok: false as const, reason: 'not_participant' };
  }

  const allParticipants = await prisma.privateConversationParticipant.findMany({
    where: { conversationId }
  });

  const message = await prisma.$transaction(async (tx) => {
    const msg = await tx.privateMessage.create({
      data: { conversationId, senderId, body },
      include: { sender: { select: senderSelect } }
    });

    if (conversation.isStaffTicket) {
      // Advance ticket status and mark owner unread when staff replies
      const newStatus: StaffInboxStatus = isStaff ? 'Open' : 'Unanswered';
      await tx.privateConversation.update({
        where: { id: conversationId },
        data: { ticketStatus: newStatus }
      });
      // Mark owner's participant record unread when staff replies
      if (isStaff) {
        for (const p of allParticipants) {
          await tx.privateConversationParticipant.update({
            where: {
              userId_conversationId: { userId: p.userId, conversationId }
            },
            data: { isRead: false }
          });
        }
      }
    } else {
      // Regular PM: mark recipients unread + restore inbox; mark sender sentbox updated
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
    }

    return msg;
  });

  return { ok: true as const, message };
}

export async function viewConversation(
  conversationId: number,
  userId: number,
  isStaff = false
) {
  const conversation = await prisma.privateConversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { sender: { select: senderSelect } }
      },
      participants: {
        include: { user: { select: senderSelect } }
      },
      assignedStaff: { select: senderSelect }
    }
  });
  if (!conversation) return { ok: false as const, reason: 'not_found' };

  // Staff can view any ticket; regular users must be participants
  if (conversation.isStaffTicket && isStaff) {
    return { ok: true as const, conversation };
  }

  const participant = conversation.participants.find(
    (p) => p.userId === userId && (p.inInbox || p.inSentbox)
  );
  if (!participant) return { ok: false as const, reason: 'not_found' };

  // Mark owner's participant record as read
  if (!participant.isRead) {
    await prisma.privateConversationParticipant.update({
      where: { userId_conversationId: { userId, conversationId } },
      data: { isRead: true }
    });
  }

  return { ok: true as const, conversation };
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

// ─── Ticket functions ─────────────────────────────────────────────────────────

const ticketInclude = {
  participants: {
    include: { user: { select: senderSelect } }
  },
  assignedStaff: { select: senderSelect }
} as const;

export async function createTicket(
  userId: number,
  subject: string,
  body: string
) {
  const conversation = await prisma.privateConversation.create({
    data: {
      subject,
      isStaffTicket: true,
      ticketStatus: 'Unanswered',
      messages: { create: { senderId: userId, body } },
      participants: {
        create: {
          userId,
          inInbox: true,
          inSentbox: false,
          isRead: true,
          sentAt: new Date()
        }
      }
    },
    include: {
      messages: { include: { sender: { select: senderSelect } } },
      ...ticketInclude
    }
  });
  return conversation;
}

export async function listMyTickets(userId: number, page: number) {
  const where = {
    isStaffTicket: true,
    participants: { some: { userId } }
  };

  const [total, conversations] = await Promise.all([
    prisma.privateConversation.count({ where }),
    prisma.privateConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        participants: { where: { userId }, select: { isRead: true } },
        assignedStaff: { select: senderSelect },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { sender: { select: senderSelect } }
        }
      }
    })
  ]);

  return { total, page, pageSize: PAGE_SIZE, conversations };
}

export async function listTicketQueue(opts: {
  page: number;
  status: StaffInboxStatus | 'all';
  assignedToMe: boolean;
  staffUserId: number;
}) {
  const { page, status, assignedToMe, staffUserId } = opts;

  const where = {
    isStaffTicket: true,
    ...(status !== 'all' ? { ticketStatus: status as StaffInboxStatus } : {}),
    ...(assignedToMe ? { assignedStaffId: staffUserId } : {})
  };

  const [total, conversations] = await Promise.all([
    prisma.privateConversation.count({ where }),
    prisma.privateConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        participants: {
          take: 1,
          orderBy: { sentAt: 'asc' },
          include: { user: { select: senderSelect } }
        },
        assignedStaff: { select: senderSelect },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { sender: { select: senderSelect } }
        }
      }
    })
  ]);

  return { total, page, pageSize: PAGE_SIZE, conversations };
}

export async function getTicketUnreadCount(): Promise<number> {
  return prisma.privateConversation.count({
    where: {
      isStaffTicket: true,
      ticketStatus: { not: 'Resolved' }
    }
  });
}

export async function resolveTicket(
  id: number,
  resolverId: number,
  isStaff: boolean
) {
  const conv = await prisma.privateConversation.findUnique({
    where: { id },
    select: {
      isStaffTicket: true,
      ticketStatus: true,
      participants: { select: { userId: true } }
    }
  });
  if (!conv || !conv.isStaffTicket)
    return { ok: false as const, reason: 'not_found' };

  const isOwner = conv.participants.some((p) => p.userId === resolverId);
  if (!isStaff && !isOwner) return { ok: false as const, reason: 'forbidden' };
  if (conv.ticketStatus === 'Resolved')
    return { ok: false as const, reason: 'already_resolved' };

  await prisma.privateConversation.update({
    where: { id },
    data: { ticketStatus: 'Resolved' }
  });

  return { ok: true as const };
}

export async function unresolveTicket(id: number) {
  const conv = await prisma.privateConversation.findUnique({
    where: { id },
    select: { isStaffTicket: true, ticketStatus: true }
  });
  if (!conv || !conv.isStaffTicket)
    return { ok: false as const, reason: 'not_found' };
  if (conv.ticketStatus !== 'Resolved')
    return { ok: false as const, reason: 'not_resolved' };

  await prisma.privateConversation.update({
    where: { id },
    data: { ticketStatus: 'Unanswered' }
  });

  return { ok: true as const };
}

export async function assignTicket(id: number, assignedUserId: number | null) {
  const conv = await prisma.privateConversation.findUnique({
    where: { id },
    select: { isStaffTicket: true }
  });
  if (!conv || !conv.isStaffTicket)
    return { ok: false as const, reason: 'not_found' };

  if (assignedUserId !== null) {
    const assignee = await prisma.user.findUnique({
      where: { id: assignedUserId },
      select: { id: true, userRank: { select: { permissions: true } } }
    });
    if (!assignee) return { ok: false as const, reason: 'assignee_not_found' };
    const perms = (assignee.userRank?.permissions ?? {}) as Record<
      string,
      boolean
    >;
    if (!perms['staff'] && !perms['admin']) {
      return { ok: false as const, reason: 'assignee_not_staff' };
    }
  }

  await prisma.privateConversation.update({
    where: { id },
    data: { assignedStaffId: assignedUserId }
  });

  return { ok: true as const };
}

export async function bulkResolveTickets(ids: number[]) {
  const convs = await prisma.privateConversation.findMany({
    where: {
      id: { in: ids },
      isStaffTicket: true,
      ticketStatus: { not: 'Resolved' }
    },
    select: { id: true }
  });

  const resolveIds = convs.map((c) => c.id);
  if (resolveIds.length === 0) return { ok: true as const, resolved: 0 };

  await prisma.privateConversation.updateMany({
    where: { id: { in: resolveIds } },
    data: { ticketStatus: 'Resolved' }
  });

  return { ok: true as const, resolved: resolveIds.length };
}
