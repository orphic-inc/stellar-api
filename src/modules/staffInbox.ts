import { prisma } from '../lib/prisma';
import {
  Prisma,
  type StaffInboxStatus,
  type StaffInboxResponse
} from '@prisma/client';
import {
  authorRefSelect,
  toAuthorRef,
  toAuthorRefOrNull,
  type AuthorRefRow
} from './authorRef';
import { hasPermission } from '../lib/rankPermissions';
import { audit } from '../lib/audit';

const PAGE_SIZE = 25;

const senderSelect = authorRefSelect;

const ticketInclude = {
  user: { select: senderSelect },
  assignedUser: { select: senderSelect },
  resolver: { select: senderSelect }
} as const;

export type StaffResponse = StaffInboxResponse;
export type StaffMessage = Prisma.StaffInboxMessageGetPayload<{
  include: { sender: true };
}>;

// Shapes a ticket's user/assignedUser/resolver/message-sender relations so the
// donor sign + warning sign follow staff and members alike in the inbox
// (#231), not just on their profile.
const mapTicketMessage = <T extends { sender: AuthorRefRow }>(message: T) => ({
  ...message,
  sender: toAuthorRef(message.sender)
});

const mapTicket = <
  T extends {
    user: AuthorRefRow;
    assignedUser: AuthorRefRow | null;
    resolver: AuthorRefRow | null;
    messages?: Array<{ sender: AuthorRefRow } & Record<string, unknown>>;
  }
>(
  ticket: T
) => ({
  ...ticket,
  user: toAuthorRef(ticket.user),
  assignedUser: toAuthorRefOrNull(ticket.assignedUser),
  resolver: toAuthorRefOrNull(ticket.resolver),
  ...(ticket.messages && { messages: ticket.messages.map(mapTicketMessage) })
});

export async function createTicket(
  userId: number,
  subject: string,
  body: string
) {
  const ticket = await prisma.staffInboxConversation.create({
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
  return mapTicket(ticket);
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
  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    conversations: conversations.map(mapTicket)
  };
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
  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    conversations: conversations.map(mapTicket)
  };
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

  // Non-owners who aren't staff must not learn the ticket exists.
  if (!isStaff && ticket.userId !== userId) {
    return { ok: false as const, reason: 'not_found' };
  }

  if (!isStaff && !ticket.isReadByUser) {
    await prisma.staffInboxConversation.update({
      where: { id },
      data: { isReadByUser: true }
    });
  }

  return { ok: true as const, ticket: mapTicket(ticket) };
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
  // Mask non-owner access as not-found rather than forbidden (no existence leak).
  if (!isStaff && ticket.userId !== senderId) {
    return { ok: false as const, reason: 'not_found' };
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
        // Staff reply → user hasn't read it yet; user reply → they have.
        isReadByUser: isStaff ? false : true
      }
    });
    return msg;
  });

  return { ok: true as const, message: mapTicketMessage(message) };
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
    return { ok: false as const, reason: 'not_found' };
  }
  if (ticket.status === 'Resolved') {
    return { ok: false as const, reason: 'already_resolved' };
  }

  await prisma.staffInboxConversation.update({
    where: { id },
    data: { status: 'Resolved', resolverId }
  });
  await audit(
    prisma,
    resolverId,
    'staff_inbox.resolve',
    'StaffInboxConversation',
    id
  );
  return { ok: true as const };
}

export async function unresolveTicket(id: number, actorId: number) {
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
  await audit(
    prisma,
    actorId,
    'staff_inbox.unresolve',
    'StaffInboxConversation',
    id
  );
  return { ok: true as const };
}

export async function assignTicket(
  id: number,
  assignedUserId: number | null,
  actorId: number
) {
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
    // Gate on the granular permission (admin passes via hasPermission), never a
    // named 'staff'/'admin' role — see ADR-0001.
    const perms = (assignee.userRank?.permissions ?? {}) as Record<
      string,
      boolean
    >;
    if (!hasPermission(perms, 'staff_inbox_manage')) {
      return { ok: false as const, reason: 'assignee_not_staff' };
    }
  }

  // Assignment does not reset conversation status — a claimed ticket keeps its
  // Open/Unanswered/Resolved state.
  await prisma.staffInboxConversation.update({
    where: { id },
    data: { assignedUserId }
  });
  await audit(
    prisma,
    actorId,
    'staff_inbox.assign',
    'StaffInboxConversation',
    id,
    { assignedUserId }
  );
  return { ok: true as const };
}

export async function bulkResolve(ids: number[], resolverId: number) {
  const tickets = await prisma.staffInboxConversation.findMany({
    where: { id: { in: ids }, status: { not: 'Resolved' } },
    select: { id: true }
  });
  const resolveIds = tickets.map((t) => t.id);
  if (resolveIds.length === 0) return { ok: true as const, resolved: 0 };

  await prisma.staffInboxConversation.updateMany({
    where: { id: { in: resolveIds } },
    data: { status: 'Resolved', resolverId }
  });
  await audit(
    prisma,
    resolverId,
    'staff_inbox.bulk_resolve',
    'StaffInboxConversation',
    undefined,
    { ids: resolveIds }
  );
  return { ok: true as const, resolved: resolveIds.length };
}

// ─── Canned responses ─────────────────────────────────────────────────────────

export async function listResponses() {
  return prisma.staffInboxResponse.findMany({ orderBy: { name: 'asc' } });
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
