import { prisma } from '../lib/prisma';
import type { StaffInboxStatus } from '@prisma/client';

const PAGE_SIZE = 25;

const senderSelect = {
  id: true,
  username: true,
  avatar: true
} as const;

const ticketInclude = {
  user: { select: senderSelect },
  assignedUser: { select: senderSelect },
  resolver: { select: senderSelect }
} as const;

export async function createTicket(
  userId: number,
  subject: string,
  body: string
) {
  return prisma.staffInboxConversation.create({
    data: {
      subject,
      userId,
      status: 'Unanswered',
      messages: { create: { senderId: userId, body } }
    },
    include: {
      ...ticketInclude,
      messages: { include: { sender: { select: senderSelect } } }
    }
  });
}

export async function listMyTickets(userId: number, page: number) {
  const where = { userId };
  const [total, conversations] = await Promise.all([
    prisma.staffInboxConversation.count({ where }),
    prisma.staffInboxConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        ...ticketInclude,
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

export async function listQueue(opts: {
  page: number;
  status: StaffInboxStatus | 'all';
  assignedToMe: boolean;
  unassigned: boolean;
  staffUserId: number;
}) {
  const { page, status, assignedToMe, unassigned, staffUserId } = opts;
  const where = {
    ...(status !== 'all' ? { status: status as StaffInboxStatus } : {}),
    ...(assignedToMe ? { assignedUserId: staffUserId } : {}),
    ...(unassigned ? { assignedUserId: null } : {})
  };

  const [total, conversations] = await Promise.all([
    prisma.staffInboxConversation.count({ where }),
    prisma.staffInboxConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        ...ticketInclude,
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

export async function getQueueCount(): Promise<number> {
  return prisma.staffInboxConversation.count({
    where: { status: { not: 'Resolved' } }
  });
}

export async function viewTicket(id: number, userId: number, isStaff: boolean) {
  const ticket = await prisma.staffInboxConversation.findUnique({
    where: { id },
    include: {
      ...ticketInclude,
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { sender: { select: senderSelect } }
      }
    }
  });
  if (!ticket) return { ok: false as const, reason: 'not_found' };

  if (!isStaff && ticket.userId !== userId) {
    return { ok: false as const, reason: 'not_found' };
  }

  if (!isStaff && !ticket.isReadByUser) {
    await prisma.staffInboxConversation.update({
      where: { id },
      data: { isReadByUser: true }
    });
  }

  return { ok: true as const, ticket };
}

export async function replyToTicket(
  id: number,
  senderId: number,
  body: string,
  isStaff: boolean
) {
  const ticket = await prisma.staffInboxConversation.findUnique({
    where: { id },
    select: { userId: true, status: true }
  });
  if (!ticket) return { ok: false as const, reason: 'not_found' };
  if (!isStaff && ticket.userId !== senderId) {
    return { ok: false as const, reason: 'forbidden' };
  }
  if (ticket.status === 'Resolved') {
    return { ok: false as const, reason: 'resolved' };
  }

  const message = await prisma.$transaction(async (tx) => {
    const msg = await tx.staffInboxMessage.create({
      data: { conversationId: id, senderId, body },
      include: { sender: { select: senderSelect } }
    });
    const newStatus: StaffInboxStatus = isStaff ? 'Open' : 'Unanswered';
    await tx.staffInboxConversation.update({
      where: { id },
      data: {
        status: newStatus,
        ...(isStaff ? { isReadByUser: false } : {})
      }
    });
    return msg;
  });

  return { ok: true as const, message };
}

export async function resolveTicket(
  id: number,
  resolverId: number,
  isStaff: boolean
) {
  const ticket = await prisma.staffInboxConversation.findUnique({
    where: { id },
    select: { userId: true, status: true }
  });
  if (!ticket) return { ok: false as const, reason: 'not_found' };
  if (!isStaff && ticket.userId !== resolverId) {
    return { ok: false as const, reason: 'forbidden' };
  }
  if (ticket.status === 'Resolved') {
    return { ok: false as const, reason: 'already_resolved' };
  }

  await prisma.staffInboxConversation.update({
    where: { id },
    data: { status: 'Resolved', resolverId }
  });
  return { ok: true as const };
}

export async function unresolveTicket(id: number) {
  const ticket = await prisma.staffInboxConversation.findUnique({
    where: { id },
    select: { status: true }
  });
  if (!ticket) return { ok: false as const, reason: 'not_found' };
  if (ticket.status !== 'Resolved') {
    return { ok: false as const, reason: 'not_resolved' };
  }

  await prisma.staffInboxConversation.update({
    where: { id },
    data: { status: 'Unanswered', resolverId: null }
  });
  return { ok: true as const };
}

export async function assignTicket(id: number, assignedUserId: number | null) {
  const ticket = await prisma.staffInboxConversation.findUnique({
    where: { id },
    select: { id: true }
  });
  if (!ticket) return { ok: false as const, reason: 'not_found' };

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

  await prisma.staffInboxConversation.update({
    where: { id },
    data: { assignedUserId }
  });
  return { ok: true as const };
}

export async function bulkResolve(ids: number[]) {
  const tickets = await prisma.staffInboxConversation.findMany({
    where: { id: { in: ids }, status: { not: 'Resolved' } },
    select: { id: true }
  });
  const resolveIds = tickets.map((t) => t.id);
  if (resolveIds.length === 0) return { ok: true as const, resolved: 0 };

  await prisma.staffInboxConversation.updateMany({
    where: { id: { in: resolveIds } },
    data: { status: 'Resolved' }
  });
  return { ok: true as const, resolved: resolveIds.length };
}
