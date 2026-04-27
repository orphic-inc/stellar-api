import { prisma } from '../lib/prisma';
import { Prisma, type StaffInboxStatus } from '@prisma/client';

const PAGE_SIZE = 25;

const userSelect = {
  id: true,
  username: true,
  avatar: true
} as const;

export const staffTicketInclude = {
  user: { select: userSelect },
  assignedUser: { select: userSelect },
  resolver: { select: userSelect },
  messages: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    include: { sender: { select: userSelect } }
  }
} as const;

export type StaffTicket = Prisma.StaffInboxConversationGetPayload<{
  include: typeof staffTicketInclude;
}>;
export type StaffResponse = Prisma.StaffInboxResponseGetPayload<{}>;
export type StaffMessage = Prisma.StaffInboxMessageGetPayload<{
  include: { sender: { select: { id: true; username: true; avatar: true } } };
}>;

export async function listStaffTickets(opts: {
  page: number;
  status: StaffInboxStatus | 'all';
  assignedToMe: boolean;
  staffUserId: number;
}) {
  const { page, status, assignedToMe, staffUserId } = opts;

  const where: Prisma.StaffInboxConversationWhereInput = {};
  if (status !== 'all') where.status = status;
  if (assignedToMe) where.assignedUserId = staffUserId;

  const [total, conversations] = await Promise.all([
    prisma.staffInboxConversation.count({ where }),
    prisma.staffInboxConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: staffTicketInclude
    })
  ]);

  return { total, page, pageSize: PAGE_SIZE, conversations };
}

export async function listMyTickets(
  userId: number,
  page: number,
  isStaff: boolean
) {
  // Staff see tickets assigned to them; regular users see tickets they submitted.
  const where = isStaff ? { assignedUserId: userId } : { userId };
  const [total, conversations] = await Promise.all([
    prisma.staffInboxConversation.count({ where }),
    prisma.staffInboxConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        assignedUser: { select: userSelect },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { sender: { select: userSelect } }
        }
      }
    })
  ]);

  return { total, page, pageSize: PAGE_SIZE, conversations };
}

export async function getStaffUnreadCount(): Promise<number> {
  return prisma.staffInboxConversation.count({
    where: { status: { not: 'Resolved' } }
  });
}

export async function createTicket(
  userId: number,
  subject: string,
  body: string
) {
  const conversation = await prisma.staffInboxConversation.create({
    data: {
      subject,
      userId,
      status: 'Unanswered',
      messages: { create: { senderId: userId, body } }
    },
    include: {
      user: { select: userSelect },
      messages: { include: { sender: { select: userSelect } } }
    }
  });
  return conversation;
}

export async function viewTicket(
  id: number,
  requesterId: number,
  isStaff: boolean
) {
  const conversation = await prisma.staffInboxConversation.findUnique({
    where: { id },
    include: {
      user: { select: userSelect },
      assignedUser: { select: userSelect },
      resolver: { select: userSelect },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { sender: { select: userSelect } }
      }
    }
  });
  if (!conversation) return { ok: false as const, reason: 'not_found' };
  if (!isStaff && conversation.userId !== requesterId) {
    return { ok: false as const, reason: 'forbidden' };
  }

  // Mark read by user when they view their own ticket
  if (!isStaff && !conversation.isReadByUser) {
    await prisma.staffInboxConversation.update({
      where: { id },
      data: { isReadByUser: true }
    });
  }

  return { ok: true as const, conversation };
}

export async function replyToTicket(
  id: number,
  senderId: number,
  body: string,
  isStaff: boolean
) {
  const conversation = await prisma.staffInboxConversation.findUnique({
    where: { id },
    select: { userId: true, status: true }
  });
  if (!conversation) return { ok: false as const, reason: 'not_found' };
  if (!isStaff && conversation.userId !== senderId) {
    return { ok: false as const, reason: 'forbidden' };
  }
  if (conversation.status === 'Resolved') {
    return { ok: false as const, reason: 'resolved' };
  }

  const newStatus: StaffInboxStatus = isStaff ? 'Open' : 'Unanswered';

  const [message] = await prisma.$transaction([
    prisma.staffInboxMessage.create({
      data: { conversationId: id, senderId, body },
      include: { sender: { select: userSelect } }
    }),
    prisma.staffInboxConversation.update({
      where: { id },
      data: {
        status: newStatus,
        // When staff replies, user hasn't read it yet; when user replies, staff hasn't read it
        isReadByUser: isStaff ? false : true
      }
    })
  ]);

  return { ok: true as const, message };
}

export async function assignTicket(id: number, assignedUserId: number | null) {
  const conversation = await prisma.staffInboxConversation.findUnique({
    where: { id },
    select: { id: true, status: true }
  });
  if (!conversation) return { ok: false as const, reason: 'not_found' };

  // If assigning to a specific user, verify they exist and are staff
  if (assignedUserId !== null) {
    const assignee = await prisma.user.findUnique({
      where: { id: assignedUserId },
      select: { id: true, userRank: { select: { permissions: true } } }
    });
    if (!assignee) return { ok: false as const, reason: 'assignee_not_found' };
    const perms = (assignee.userRank.permissions ?? {}) as Record<
      string,
      boolean
    >;
    if (!perms['staff'] && !perms['admin']) {
      return { ok: false as const, reason: 'assignee_not_staff' };
    }
  }

  await prisma.staffInboxConversation.update({
    where: { id },
    data: {
      assignedUserId,
      status: 'Unanswered'
    }
  });

  return { ok: true as const };
}

export async function resolveTicket(
  id: number,
  resolverId: number,
  isStaff: boolean
) {
  const conversation = await prisma.staffInboxConversation.findUnique({
    where: { id },
    select: { userId: true, status: true }
  });
  if (!conversation) return { ok: false as const, reason: 'not_found' };
  if (!isStaff && conversation.userId !== resolverId) {
    return { ok: false as const, reason: 'forbidden' };
  }
  if (conversation.status === 'Resolved') {
    return { ok: false as const, reason: 'already_resolved' };
  }

  await prisma.staffInboxConversation.update({
    where: { id },
    data: { status: 'Resolved', resolverId }
  });

  return { ok: true as const };
}

export async function unresolveTicket(id: number) {
  const conversation = await prisma.staffInboxConversation.findUnique({
    where: { id },
    select: { status: true }
  });
  if (!conversation) return { ok: false as const, reason: 'not_found' };
  if (conversation.status !== 'Resolved') {
    return { ok: false as const, reason: 'not_resolved' };
  }

  await prisma.staffInboxConversation.update({
    where: { id },
    data: { status: 'Unanswered', resolverId: null }
  });

  return { ok: true as const };
}

export async function bulkResolveTickets(ids: number[], resolverId: number) {
  const conversations = await prisma.staffInboxConversation.findMany({
    where: { id: { in: ids }, status: { not: 'Resolved' } },
    select: { id: true }
  });

  const resolveIds = conversations.map((c) => c.id);
  if (resolveIds.length === 0) return { ok: true as const, resolved: 0 };

  await prisma.staffInboxConversation.updateMany({
    where: { id: { in: resolveIds } },
    data: { status: 'Resolved', resolverId }
  });

  return { ok: true as const, resolved: resolveIds.length };
}

// Canned responses

export async function listResponses() {
  return prisma.staffInboxResponse.findMany({
    orderBy: { name: 'asc' }
  });
}

export async function createResponse(name: string, body: string) {
  return prisma.staffInboxResponse.create({ data: { name, body } });
}

export async function updateResponse(
  id: number,
  data: { name?: string; body?: string }
) {
  const existing = await prisma.staffInboxResponse.findUnique({
    where: { id }
  });
  if (!existing) return { ok: false as const, reason: 'not_found' };
  const updated = await prisma.staffInboxResponse.update({
    where: { id },
    data
  });
  return { ok: true as const, response: updated };
}

export async function deleteResponse(id: number) {
  const existing = await prisma.staffInboxResponse.findUnique({
    where: { id }
  });
  if (!existing) return { ok: false as const, reason: 'not_found' };
  await prisma.staffInboxResponse.delete({ where: { id } });
  return { ok: true as const };
}
