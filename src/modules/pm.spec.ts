const mockTx = {
  privateConversation: {
    create: jest.fn()
  },
  privateMessage: {
    create: jest.fn()
  },
  privateConversationParticipant: {
    update: jest.fn()
  }
};

const mockTransaction = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    privateConversation: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn()
    },
    privateConversationParticipant: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    privateMessage: {
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
  bulkUpdateConversations,
  deleteConversation,
  getUnreadCount,
  listInbox,
  listSentbox,
  replyToConversation,
  sendMessage,
  sendSystemMessage,
  updateConversationFlags,
  viewConversation
} from './pm';

const prismaMock = prisma as unknown as {
  privateConversation: {
    count: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  privateConversationParticipant: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  user: { findUnique: jest.Mock };
};

const makeConversation = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  subject: 'Hello',
  participants: [],
  messages: [],
  ...overrides
});

beforeEach(() => {
  mockTransaction.mockImplementation(
    (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)
  );
});

describe('listInbox', () => {
  it('filters by inbox membership and optional search', async () => {
    prismaMock.privateConversation.count.mockResolvedValue(2);
    prismaMock.privateConversation.findMany.mockResolvedValue([
      makeConversation()
    ]);

    const result = await listInbox(7, 2, 'hello');

    expect(prismaMock.privateConversation.count).toHaveBeenCalledWith({
      where: {
        participants: { some: { userId: 7, inInbox: true } },
        subject: { contains: 'hello', mode: 'insensitive' }
      }
    });
    expect(prismaMock.privateConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 25,
        take: 25,
        where: expect.objectContaining({
          participants: { some: { userId: 7, inInbox: true } }
        })
      })
    );
    expect(result.total).toBe(2);
    expect(result.page).toBe(2);
  });
});

describe('listSentbox', () => {
  it('filters by sentbox membership', async () => {
    prismaMock.privateConversation.count.mockResolvedValue(1);
    prismaMock.privateConversation.findMany.mockResolvedValue([
      makeConversation()
    ]);

    const result = await listSentbox(7, 1);

    expect(prismaMock.privateConversation.count).toHaveBeenCalledWith({
      where: { participants: { some: { userId: 7, inSentbox: true } } }
    });
    expect(result.pageSize).toBe(25);
  });
});

describe('getUnreadCount', () => {
  it('counts unread inbox conversations for the user', async () => {
    prismaMock.privateConversation.count.mockResolvedValue(4);

    await expect(getUnreadCount(7)).resolves.toBe(4);
    expect(prismaMock.privateConversation.count).toHaveBeenCalledWith({
      where: {
        participants: { some: { userId: 7, inInbox: true, isRead: false } }
      }
    });
  });
});

describe('sendMessage', () => {
  it('rejects self messaging before any database lookup', async () => {
    await expect(sendMessage(7, 7, 'Hi', 'Body')).resolves.toEqual({
      ok: false,
      reason: 'self_message'
    });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects missing or unavailable recipients', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    await expect(sendMessage(7, 9, 'Hi', 'Body')).resolves.toEqual({
      ok: false,
      reason: 'recipient_not_found'
    });

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 9,
      disabled: true,
      disablePm: false
    });
    await expect(sendMessage(7, 9, 'Hi', 'Body')).resolves.toEqual({
      ok: false,
      reason: 'recipient_disabled'
    });

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 9,
      disabled: false,
      disablePm: true
    });
    await expect(sendMessage(7, 9, 'Hi', 'Body')).resolves.toEqual({
      ok: false,
      reason: 'recipient_pm_disabled'
    });
  });

  it('creates a conversation with inbox and sentbox participants', async () => {
    const created = makeConversation({
      participants: [
        { userId: 9, inInbox: true, inSentbox: false, isRead: false },
        { userId: 7, inInbox: false, inSentbox: true, isRead: true }
      ],
      messages: [{ id: 10, body: 'Body' }]
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 9,
      disabled: false,
      disablePm: false
    });
    mockTx.privateConversation.create.mockResolvedValue(created);

    const result = await sendMessage(7, 9, 'Subject', 'Body');

    expect(result).toEqual({ ok: true, conversation: created });
    expect(mockTx.privateConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subject: 'Subject',
          messages: { create: { senderId: 7, body: 'Body' } },
          participants: {
            create: expect.arrayContaining([
              expect.objectContaining({
                userId: 9,
                inInbox: true,
                inSentbox: false,
                isRead: false
              }),
              expect.objectContaining({
                userId: 7,
                inInbox: false,
                inSentbox: true,
                isRead: true
              })
            ])
          }
        })
      })
    );
  });
});

describe('sendSystemMessage', () => {
  it('creates a no-sender, single-recipient conversation', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 9, disabled: false });
    prismaMock.privateConversation.create.mockResolvedValue(
      makeConversation({ id: 5 })
    );

    const result = await sendSystemMessage(9, 'Subj', 'Body');

    expect(result).toEqual({
      ok: true,
      conversation: expect.objectContaining({ id: 5 })
    });
    const arg = prismaMock.privateConversation.create.mock.calls[0][0];
    expect(arg.data.subject).toBe('Subj');
    // System notice: null sender (unclickable / no-reply), one participant.
    expect(arg.data.messages.create).toEqual({ senderId: null, body: 'Body' });
    expect(arg.data.participants.create).toEqual(
      expect.objectContaining({ userId: 9, inInbox: true, isRead: false })
    );
  });

  it('returns recipient_not_found for a missing user', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(sendSystemMessage(9, 'S', 'B')).resolves.toEqual({
      ok: false,
      reason: 'recipient_not_found'
    });
    expect(prismaMock.privateConversation.create).not.toHaveBeenCalled();
  });

  it('returns recipient_disabled for a disabled user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 9, disabled: true });
    await expect(sendSystemMessage(9, 'S', 'B')).resolves.toEqual({
      ok: false,
      reason: 'recipient_disabled'
    });
    expect(prismaMock.privateConversation.create).not.toHaveBeenCalled();
  });
});

describe('replyToConversation', () => {
  it('rejects callers that are not visible participants', async () => {
    prismaMock.privateConversationParticipant.findFirst.mockResolvedValue(null);

    await expect(replyToConversation(1, 7, 'Reply')).resolves.toEqual({
      ok: false,
      reason: 'not_participant'
    });
  });

  it('creates a reply and flips sender/recipient inbox state', async () => {
    prismaMock.privateConversationParticipant.findFirst.mockResolvedValue({
      userId: 7,
      conversationId: 1,
      inInbox: true,
      inSentbox: false
    });
    prismaMock.privateConversationParticipant.findMany.mockResolvedValue([
      { userId: 7, conversationId: 1 },
      { userId: 9, conversationId: 1 }
    ]);
    mockTx.privateMessage.create.mockResolvedValue({
      id: 11,
      body: 'Reply',
      sender: { id: 7 }
    });

    const result = await replyToConversation(1, 7, 'Reply');

    expect(result.ok).toBe(true);
    expect(mockTx.privateMessage.create).toHaveBeenCalledWith({
      data: { conversationId: 1, senderId: 7, body: 'Reply' },
      include: { sender: { select: expect.any(Object) } }
    });
    expect(
      mockTx.privateConversationParticipant.update
    ).toHaveBeenNthCalledWith(1, {
      where: { userId_conversationId: { userId: 7, conversationId: 1 } },
      data: { inSentbox: true, isRead: true, sentAt: expect.any(Date) }
    });
    expect(
      mockTx.privateConversationParticipant.update
    ).toHaveBeenNthCalledWith(2, {
      where: { userId_conversationId: { userId: 9, conversationId: 1 } },
      data: { inInbox: true, isRead: false, receivedAt: expect.any(Date) }
    });
  });
});

describe('viewConversation', () => {
  it('returns not_found when the conversation does not exist', async () => {
    prismaMock.privateConversation.findUnique.mockResolvedValue(null);

    await expect(viewConversation(1, 7)).resolves.toEqual({
      ok: false,
      reason: 'not_found'
    });
  });

  it('returns not_found when the user is not a participant', async () => {
    prismaMock.privateConversation.findUnique.mockResolvedValue(
      makeConversation({
        participants: [{ userId: 9, inInbox: true, inSentbox: false }]
      })
    );

    await expect(viewConversation(1, 7)).resolves.toEqual({
      ok: false,
      reason: 'not_found'
    });
  });

  it('marks unread conversations as read for the viewer', async () => {
    const conversation = makeConversation({
      participants: [
        { userId: 7, inInbox: true, inSentbox: false, isRead: false }
      ]
    });
    prismaMock.privateConversation.findUnique.mockResolvedValue(conversation);
    prismaMock.privateConversationParticipant.update.mockResolvedValue(
      undefined
    );

    const result = await viewConversation(1, 7);

    expect(result).toEqual({ ok: true, conversation });
    expect(
      prismaMock.privateConversationParticipant.update
    ).toHaveBeenCalledWith({
      where: { userId_conversationId: { userId: 7, conversationId: 1 } },
      data: { isRead: true }
    });
  });
});

describe('updateConversationFlags', () => {
  it('returns not_found for inaccessible conversations', async () => {
    prismaMock.privateConversationParticipant.findFirst.mockResolvedValue(null);

    await expect(
      updateConversationFlags(1, 7, { isSticky: true })
    ).resolves.toEqual({
      ok: false,
      reason: 'not_found'
    });
  });

  it('updates sticky and read flags for visible conversations', async () => {
    prismaMock.privateConversationParticipant.findFirst.mockResolvedValue({
      userId: 7,
      conversationId: 1
    });
    prismaMock.privateConversationParticipant.update.mockResolvedValue(
      undefined
    );

    await expect(
      updateConversationFlags(1, 7, { isSticky: true, isRead: false })
    ).resolves.toEqual({ ok: true });
    expect(
      prismaMock.privateConversationParticipant.update
    ).toHaveBeenCalledWith({
      where: { userId_conversationId: { userId: 7, conversationId: 1 } },
      data: { isSticky: true, isRead: false }
    });
  });
});

describe('deleteConversation', () => {
  it('returns not_found when the user is not a participant', async () => {
    prismaMock.privateConversationParticipant.findFirst.mockResolvedValue(null);

    await expect(deleteConversation(1, 7)).resolves.toEqual({
      ok: false,
      reason: 'not_found'
    });
  });

  it('hides the conversation from inbox and sentbox for that user', async () => {
    prismaMock.privateConversationParticipant.findFirst.mockResolvedValue({
      userId: 7,
      conversationId: 1
    });
    prismaMock.privateConversationParticipant.update.mockResolvedValue(
      undefined
    );

    await expect(deleteConversation(1, 7)).resolves.toEqual({ ok: true });
    expect(
      prismaMock.privateConversationParticipant.update
    ).toHaveBeenCalledWith({
      where: { userId_conversationId: { userId: 7, conversationId: 1 } },
      data: { inInbox: false, inSentbox: false, isSticky: false }
    });
  });
});

describe('bulkUpdateConversations', () => {
  it('marks selected conversations unread', async () => {
    prismaMock.privateConversationParticipant.updateMany.mockResolvedValue({
      count: 2
    });

    await expect(
      bulkUpdateConversations(7, [1, 2], 'markUnread')
    ).resolves.toEqual({ ok: true });
    expect(
      prismaMock.privateConversationParticipant.updateMany
    ).toHaveBeenCalledWith({
      where: {
        userId: 7,
        conversationId: { in: [1, 2] },
        OR: [{ inInbox: true }, { inSentbox: true }]
      },
      data: { isRead: false }
    });
  });

  it('applies delete action by clearing visibility flags', async () => {
    prismaMock.privateConversationParticipant.updateMany.mockResolvedValue({
      count: 1
    });

    await bulkUpdateConversations(7, [3], 'delete');

    expect(
      prismaMock.privateConversationParticipant.updateMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { inInbox: false, inSentbox: false, isSticky: false }
      })
    );
  });
});
