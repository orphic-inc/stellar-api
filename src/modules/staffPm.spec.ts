import type { StaffInboxStatus } from '@prisma/client';

const mockTx = {
  staffInboxConversation: {
    create: jest.fn(),
    update: jest.fn()
  },
  staffInboxMessage: {
    create: jest.fn()
  }
};

const mockTransaction = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    staffInboxConversation: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    staffInboxMessage: {
      create: jest.fn()
    },
    user: {
      findUnique: jest.fn()
    },
    $transaction: mockTransaction
  }
}));

import { prisma } from '../lib/prisma';
import {
  createTicket,
  viewTicket,
  replyToTicket,
  resolveTicket,
  unresolveTicket,
  assignTicket,
  bulkResolve
} from './staffPm';

const prismaMock = prisma as unknown as {
  staffInboxConversation: {
    create: jest.Mock;
    count: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  user: { findUnique: jest.Mock };
};

// Minimal AuthorRef-shaped row (#231): a plain donor/warning-free user unless
// a test overrides it, so mapTicket's transform is a no-op on the fields it
// doesn't touch.
const makeAuthorRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  username: 'testuser',
  avatar: null,
  isDonor: false,
  warned: null,
  donorRank: null,
  ...overrides
});

const makeTicket = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 7,
  subject: 'Need help',
  status: 'Unanswered' as StaffInboxStatus,
  isReadByUser: false,
  assignedUserId: null,
  resolverId: null,
  user: makeAuthorRow(),
  assignedUser: null,
  resolver: null,
  messages: [],
  ...overrides
});

beforeEach(() => {
  mockTransaction.mockImplementation(
    (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)
  );
});

describe('createTicket', () => {
  it('creates an unanswered ticket with the initial message', async () => {
    const created = makeTicket({
      messages: [{ id: 10, body: 'Please help', sender: makeAuthorRow() }]
    });
    prismaMock.staffInboxConversation.create.mockResolvedValue(created);

    const result = await createTicket(7, 'Need help', 'Please help');

    expect(prismaMock.staffInboxConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subject: 'Need help',
          userId: 7,
          status: 'Unanswered',
          messages: { create: { senderId: 7, body: 'Please help' } }
        })
      })
    );
    expect(result).toEqual(created);
  });

  // #231 — the ticket owner and each message sender must carry isDonor/warned/
  // donorRank so the donor sign + warning sign render in the staff inbox, not
  // just on the profile page.
  it('carries the donor sign and warning sign on the ticket owner and sender', async () => {
    const created = makeTicket({
      user: makeAuthorRow({
        isDonor: true,
        warned: new Date('2026-01-01T00:00:00.000Z'),
        donorRank: {
          expiresAt: null,
          donorRank: { name: 'Patron', badge: 'patron.png', color: '#fff' }
        }
      }),
      messages: [
        {
          id: 10,
          body: 'Please help',
          sender: makeAuthorRow({ isDonor: true })
        }
      ]
    });
    prismaMock.staffInboxConversation.create.mockResolvedValue(created);

    const result = await createTicket(7, 'Need help', 'Please help');

    expect(result.user).toEqual({
      id: 7,
      username: 'testuser',
      avatar: null,
      isDonor: true,
      donorRank: { name: 'Patron', badge: 'patron.png', color: '#fff' },
      warned: '2026-01-01T00:00:00.000Z'
    });
    expect(result.messages[0].sender).toEqual(
      expect.objectContaining({ isDonor: true })
    );
  });
});

describe('viewTicket', () => {
  it('returns not_found for a non-staff user viewing another user ticket', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue(
      makeTicket({ userId: 99 })
    );

    await expect(viewTicket(1, 7, false)).resolves.toEqual({
      ok: false,
      reason: 'not_found'
    });
  });

  it('marks an unread owner ticket as read', async () => {
    const ticket = makeTicket({ isReadByUser: false });
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue(ticket);
    prismaMock.staffInboxConversation.update.mockResolvedValue(undefined);

    const result = await viewTicket(1, 7, false);

    expect(result).toEqual({ ok: true, ticket });
    expect(prismaMock.staffInboxConversation.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isReadByUser: true }
    });
  });
});

describe('replyToTicket', () => {
  it('moves staff replies to Open and marks the ticket unread for the user', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue(
      makeTicket({ status: 'Unanswered' })
    );
    mockTx.staffInboxMessage.create.mockResolvedValue({
      id: 20,
      body: 'Staff reply',
      sender: { id: 11 }
    });
    mockTx.staffInboxConversation.update.mockResolvedValue(undefined);

    const result = await replyToTicket(1, 11, 'Staff reply', true);

    expect(result.ok).toBe(true);
    expect(mockTx.staffInboxConversation.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'Open', isReadByUser: false }
    });
  });

  it('moves user replies back to Unanswered', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue(
      makeTicket({ status: 'Open' })
    );
    mockTx.staffInboxMessage.create.mockResolvedValue({
      id: 21,
      body: 'User reply',
      sender: { id: 7 }
    });
    mockTx.staffInboxConversation.update.mockResolvedValue(undefined);

    const result = await replyToTicket(1, 7, 'User reply', false);

    expect(result.ok).toBe(true);
    expect(mockTx.staffInboxConversation.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'Unanswered' }
    });
  });

  it('rejects replies to resolved tickets', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue(
      makeTicket({ status: 'Resolved' })
    );

    await expect(replyToTicket(1, 7, 'Reply', false)).resolves.toEqual({
      ok: false,
      reason: 'resolved'
    });
  });
});

describe('resolveTicket', () => {
  it('allows owners to resolve their own ticket', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue(
      makeTicket({ userId: 7, status: 'Open' })
    );
    prismaMock.staffInboxConversation.update.mockResolvedValue(undefined);

    const result = await resolveTicket(1, 7, false);

    expect(result).toEqual({ ok: true });
    expect(prismaMock.staffInboxConversation.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'Resolved', resolverId: 7 }
    });
  });

  it('rejects unrelated non-staff users', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue(
      makeTicket({ userId: 99, status: 'Open' })
    );

    await expect(resolveTicket(1, 7, false)).resolves.toEqual({
      ok: false,
      reason: 'forbidden'
    });
  });
});

describe('unresolveTicket', () => {
  it('returns the ticket to Unanswered', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue(
      makeTicket({ status: 'Resolved' })
    );
    prismaMock.staffInboxConversation.update.mockResolvedValue(undefined);

    const result = await unresolveTicket(1);

    expect(result).toEqual({ ok: true });
    expect(prismaMock.staffInboxConversation.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'Unanswered', resolverId: null }
    });
  });
});

describe('assignTicket', () => {
  it('rejects assignees without staff/admin permissions', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue(
      makeTicket({ id: 1 })
    );
    prismaMock.user.findUnique.mockResolvedValue({
      id: 12,
      userRank: { permissions: { staff: false, admin: false } }
    });

    await expect(assignTicket(1, 12)).resolves.toEqual({
      ok: false,
      reason: 'assignee_not_staff'
    });
  });

  it('assigns a valid staff user', async () => {
    prismaMock.staffInboxConversation.findUnique.mockResolvedValue(
      makeTicket({ id: 1 })
    );
    prismaMock.user.findUnique.mockResolvedValue({
      id: 12,
      userRank: { permissions: { staff: true } }
    });
    prismaMock.staffInboxConversation.update.mockResolvedValue(undefined);

    const result = await assignTicket(1, 12);

    expect(result).toEqual({ ok: true });
    expect(prismaMock.staffInboxConversation.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { assignedUserId: 12 }
    });
  });
});

describe('bulkResolve', () => {
  it('resolves only unresolved tickets and reports the count', async () => {
    prismaMock.staffInboxConversation.findMany.mockResolvedValue([
      { id: 1 },
      { id: 3 }
    ]);
    prismaMock.staffInboxConversation.updateMany.mockResolvedValue({
      count: 2
    });

    const result = await bulkResolve([1, 2, 3]);

    expect(result).toEqual({ ok: true, resolved: 2 });
    expect(prismaMock.staffInboxConversation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 3] } },
      data: { status: 'Resolved' }
    });
  });
});
