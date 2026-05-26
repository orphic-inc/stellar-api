const mockTx = {
  forumTopic: {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn()
  },
  forumPost: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn()
  },
  forum: {
    update: jest.fn(),
    delete: jest.fn()
  },
  forumPoll: {
    create: jest.fn()
  },
  subscription: {
    findMany: jest.fn()
  },
  notification: {
    createMany: jest.fn()
  },
  forumPostEdit: {
    create: jest.fn()
  },
  auditLog: {
    create: jest.fn()
  },
  user: {
    findMany: jest.fn()
  }
};

jest.mock('../lib/prisma', () => ({
  prisma: {
    forum: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    },
    forumTopic: {
      update: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn()
    },
    forumPost: {
      count: jest.fn()
    },
    forumPoll: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    forumPollVote: {
      upsert: jest.fn()
    },
    auditLog: {
      create: jest.fn()
    },
    $transaction: jest.fn((arg: unknown) => {
      if (typeof arg === 'function') return arg(mockTx);
      return Promise.all(arg as Promise<unknown>[]);
    })
  }
}));

jest.mock('../lib/sanitize', () => ({
  sanitizeHtml: (value: string) => `[html]${value}`,
  sanitizePlain: (value: string) => `[plain]${value}`
}));

import { prisma } from '../lib/prisma';
import {
  castVote,
  createPost,
  createTopic,
  deleteForum,
  deletePost,
  deleteTopic,
  updatePost,
  updateTopic
} from './forum';

const prismaMock = prisma as unknown as {
  forum: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  forumTopic: {
    update: jest.Mock;
    count: jest.Mock;
    updateMany: jest.Mock;
  };
  forumPost: {
    count: jest.Mock;
  };
  forumPoll: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  forumPollVote: {
    upsert: jest.Mock;
  };
  auditLog: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};

describe('createTopic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') return arg(mockTx);
      return Promise.all(arg as Promise<unknown>[]);
    });
  });

  it('creates topic, first post, counter updates, and optional poll', async () => {
    mockTx.forumTopic.create.mockResolvedValue({
      id: 44,
      forumId: 9,
      authorId: 7
    });
    mockTx.forumPost.create.mockResolvedValue({ id: 21, forumTopicId: 44 });
    mockTx.forumTopic.update.mockResolvedValue(undefined);
    mockTx.forum.update.mockResolvedValue(undefined);
    mockTx.forumPoll.create.mockResolvedValue(undefined);

    const result = await createTopic(9, 7, {
      title: 'Topic',
      body: 'Opening body',
      question: 'Poll?',
      answers: 'Yes,No'
    });

    expect(result.id).toBe(44);
    expect(mockTx.forumPost.create).toHaveBeenCalledWith({
      data: { forumTopicId: 44, authorId: 7, body: '[html]Opening body' }
    });
    expect(mockTx.forum.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        lastTopicId: 44,
        numTopics: { increment: 1 },
        numPosts: { increment: 1 }
      }
    });
    expect(mockTx.forumPoll.create).toHaveBeenCalledWith({
      data: {
        forumTopicId: 44,
        question: '[plain]Poll?',
        answers: '[plain]Yes,No'
      }
    });
  });
});

describe('createPost', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') return arg(mockTx);
      return Promise.all(arg as Promise<unknown>[]);
    });
  });

  it('creates notifications for subscribers other than the author', async () => {
    mockTx.forumTopic.findUnique.mockResolvedValue({ lastPostId: null });
    mockTx.forumPost.create.mockResolvedValue({ id: 31, forumTopicId: 44 });
    mockTx.forumTopic.update.mockResolvedValue(undefined);
    mockTx.forum.update.mockResolvedValue(undefined);
    mockTx.subscription.findMany.mockResolvedValue([
      { userId: 7 },
      { userId: 9 },
      { userId: 11 }
    ]);
    mockTx.notification.createMany.mockResolvedValue({ count: 2 });

    await createPost(9, 44, 7, 'Reply');

    expect(mockTx.forumPost.create).toHaveBeenCalledWith({
      data: { forumTopicId: 44, authorId: 7, body: '[html]Reply' }
    });
    expect(mockTx.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 9,
          type: 'forum_sub',
          actorId: 7,
          page: 'forums',
          pageId: 44,
          postId: 31
        },
        {
          userId: 11,
          type: 'forum_sub',
          actorId: 7,
          page: 'forums',
          pageId: 44,
          postId: 31
        }
      ],
      skipDuplicates: true
    });
  });

  it('skips notification writes when no other subscribers exist', async () => {
    mockTx.forumTopic.findUnique.mockResolvedValue({ lastPostId: null });
    mockTx.forumPost.create.mockResolvedValue({ id: 32, forumTopicId: 44 });
    mockTx.forumTopic.update.mockResolvedValue(undefined);
    mockTx.forum.update.mockResolvedValue(undefined);
    mockTx.subscription.findMany.mockResolvedValue([{ userId: 7 }]);

    await createPost(9, 44, 7, 'Reply');

    expect(mockTx.notification.createMany).not.toHaveBeenCalled();
  });

  it('merges into last post when last post is by the same author', async () => {
    mockTx.forumTopic.findUnique.mockResolvedValue({ lastPostId: 31 });
    mockTx.forumPost.findUnique.mockResolvedValue({
      id: 31,
      authorId: 7,
      body: '[html]Previous'
    });
    mockTx.forumPost.update.mockResolvedValue({
      id: 31,
      body: '[html]Previous\n\n[html]Reply'
    });
    mockTx.forumTopic.update.mockResolvedValue(undefined);
    mockTx.forum.update.mockResolvedValue(undefined);

    const result = await createPost(9, 44, 7, 'Reply');

    expect(mockTx.forumPost.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: { body: '[html]Previous\n\n[html]Reply' }
    });
    expect(mockTx.forumTopic.update).toHaveBeenCalledWith({
      where: { id: 44 },
      data: { lastPostId: 31 }
    });
    expect(mockTx.forum.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { lastTopicId: 44 }
    });
    expect(mockTx.notification.createMany).not.toHaveBeenCalled();
    expect(mockTx.forumPost.create).not.toHaveBeenCalled();
    expect(result.id).toBe(31);
  });

  it('creates a new post when last post is by a different author', async () => {
    mockTx.forumTopic.findUnique.mockResolvedValue({ lastPostId: 30 });
    mockTx.forumPost.findUnique.mockResolvedValue({
      id: 30,
      authorId: 99,
      body: '[html]Other'
    });
    mockTx.forumPost.create.mockResolvedValue({ id: 31, forumTopicId: 44 });
    mockTx.forumTopic.update.mockResolvedValue(undefined);
    mockTx.forum.update.mockResolvedValue(undefined);
    mockTx.subscription.findMany.mockResolvedValue([]);

    await createPost(9, 44, 7, 'Reply');

    expect(mockTx.forumPost.create).toHaveBeenCalled();
  });

  it('emits forum_quote notifications for quoted users in a new post', async () => {
    mockTx.forumTopic.findUnique.mockResolvedValue({ lastPostId: null });
    mockTx.forumPost.create.mockResolvedValue({ id: 31, forumTopicId: 44 });
    mockTx.forumTopic.update.mockResolvedValue(undefined);
    mockTx.forum.update.mockResolvedValue(undefined);
    mockTx.subscription.findMany.mockResolvedValue([]);
    mockTx.user.findMany.mockResolvedValue([{ id: 20 }]);
    mockTx.notification.createMany.mockResolvedValue({ count: 1 });

    await createPost(9, 44, 7, '[quote=alice]great post[/quote]');

    expect(mockTx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          username: { in: ['alice'], mode: 'insensitive' },
          disabled: false
        })
      })
    );
    expect(mockTx.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: 20,
            type: 'forum_quote',
            actorId: 7,
            page: 'forums',
            pageId: 44,
            postId: 31
          })
        ])
      })
    );
  });

  it('does not emit forum_quote when the author quotes themselves', async () => {
    mockTx.forumTopic.findUnique.mockResolvedValue({ lastPostId: null });
    mockTx.forumPost.create.mockResolvedValue({ id: 31, forumTopicId: 44 });
    mockTx.forumTopic.update.mockResolvedValue(undefined);
    mockTx.forum.update.mockResolvedValue(undefined);
    mockTx.subscription.findMany.mockResolvedValue([]);
    // user.findMany returns the author themselves (id=7, same as authorId)
    mockTx.user.findMany.mockResolvedValue([{ id: 7 }]);
    mockTx.notification.createMany.mockResolvedValue({ count: 0 });

    await createPost(9, 44, 7, '[quote=self]my own earlier post[/quote]');

    expect(mockTx.notification.createMany).not.toHaveBeenCalled();
  });

  it('skips forum_quote lookup when no [quote=] tags are present', async () => {
    mockTx.forumTopic.findUnique.mockResolvedValue({ lastPostId: null });
    mockTx.forumPost.create.mockResolvedValue({ id: 33, forumTopicId: 44 });
    mockTx.forumTopic.update.mockResolvedValue(undefined);
    mockTx.forum.update.mockResolvedValue(undefined);
    mockTx.subscription.findMany.mockResolvedValue([]);

    await createPost(9, 44, 7, 'Just a plain reply');

    expect(mockTx.user.findMany).not.toHaveBeenCalled();
  });
});

describe('updatePost', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') return arg(mockTx);
      return Promise.all(arg as Promise<unknown>[]);
    });
  });

  it('updates the post and records the previous body', async () => {
    mockTx.forumPost.update.mockResolvedValue({ id: 21, body: '[html]New' });
    mockTx.forumPostEdit.create.mockResolvedValue(undefined);

    const result = await updatePost(21, 7, 'Old', 'New', 44);

    expect(result.body).toBe('[html]New');
    expect(mockTx.forumPostEdit.create).toHaveBeenCalledWith({
      data: { forumPostId: 21, editorId: 7, previousBody: 'Old' }
    });
  });

  it('emits forum_quote for newly introduced quotes on edit', async () => {
    mockTx.forumPost.update.mockResolvedValue({
      id: 21,
      body: '[html]Updated'
    });
    mockTx.forumPostEdit.create.mockResolvedValue(undefined);
    mockTx.user.findMany.mockResolvedValue([{ id: 30 }]);
    mockTx.notification.createMany.mockResolvedValue({ count: 1 });

    await updatePost(
      21,
      7,
      'Old body with no quotes',
      '[quote=bob]Nice[/quote]',
      44
    );

    expect(mockTx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          username: { in: ['bob'], mode: 'insensitive' }
        })
      })
    );
    expect(mockTx.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: 30, type: 'forum_quote' })
        ])
      })
    );
  });

  it('does not re-notify for quotes that were already in the original body', async () => {
    mockTx.forumPost.update.mockResolvedValue({ id: 21, body: '[html]Same' });
    mockTx.forumPostEdit.create.mockResolvedValue(undefined);

    await updatePost(
      21,
      7,
      '[quote=alice]already here[/quote]',
      '[quote=alice]still here[/quote] with more text',
      44
    );

    expect(mockTx.user.findMany).not.toHaveBeenCalled();
  });
});

describe('deleteTopic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') return arg(mockTx);
      return Promise.all(arg as Promise<unknown>[]);
    });
  });

  it('soft deletes the topic, decrements counts, and writes an audit row', async () => {
    prismaMock.forumPost.count.mockResolvedValue(3);

    await deleteTopic(44, 9, 7, true);

    expect(prismaMock.forumPost.count).toHaveBeenCalledWith({
      where: { forumTopicId: 44, deletedAt: null }
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.forum.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        numTopics: { decrement: 1 },
        numPosts: { decrement: 3 }
      }
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 7,
        action: 'topic.mod_delete',
        targetType: 'ForumTopic',
        targetId: 44
      }
    });
  });
});

describe('deletePost', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') return arg(mockTx);
      return Promise.all(arg as Promise<unknown>[]);
    });
  });

  it('soft deletes the topic when the last live post is removed', async () => {
    mockTx.forumPost.update.mockResolvedValue(undefined);
    mockTx.forumTopic.update.mockResolvedValue(undefined);
    mockTx.forum.update.mockResolvedValue(undefined);
    mockTx.auditLog.create.mockResolvedValue(undefined);
    mockTx.forumPost.count.mockResolvedValue(0);

    await deletePost(21, 44, 9, 7, false);

    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 7,
        action: 'post.delete',
        targetType: 'ForumPost',
        targetId: 21
      }
    });
    expect(mockTx.forumTopic.update).toHaveBeenLastCalledWith({
      where: { id: 44 },
      data: { deletedAt: expect.any(Date) }
    });
    expect(mockTx.forum.update).toHaveBeenLastCalledWith({
      where: { id: 9 },
      data: { numTopics: { decrement: 1 } }
    });
  });
});

describe('updateTopic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') return arg(mockTx);
      return Promise.all(arg as Promise<unknown>[]);
    });
  });

  it('only forwards provided fields', async () => {
    prismaMock.forumTopic.update.mockResolvedValue({ id: 44 });

    await updateTopic(44, { isLocked: true });

    expect(prismaMock.forumTopic.update).toHaveBeenCalledWith({
      where: { id: 44 },
      data: { isLocked: true }
    });
  });
});

describe('deleteForum', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') return arg(mockTx);
      return Promise.all(arg as Promise<unknown>[]);
    });
  });

  it('returns reason variants for missing, trash, and missing trash forum', async () => {
    prismaMock.forum.findUnique.mockResolvedValueOnce(null);
    await expect(deleteForum(9)).resolves.toEqual({
      ok: false,
      reason: 'not_found'
    });

    prismaMock.forum.findUnique.mockResolvedValueOnce({ id: 9, isTrash: true });
    await expect(deleteForum(9)).resolves.toEqual({
      ok: false,
      reason: 'is_trash'
    });

    prismaMock.forum.findUnique.mockResolvedValueOnce({
      id: 9,
      isTrash: false
    });
    prismaMock.forum.findFirst.mockResolvedValueOnce(null);
    await expect(deleteForum(9)).resolves.toEqual({
      ok: false,
      reason: 'no_trash'
    });
  });

  it('moves topics into trash forum and deletes the source forum', async () => {
    prismaMock.forum.findUnique.mockResolvedValue({ id: 9, isTrash: false });
    prismaMock.forum.findFirst.mockResolvedValue({ id: 1, isTrash: true });
    prismaMock.forumTopic.count.mockResolvedValue(4);
    prismaMock.forumPost.count.mockResolvedValue(12);

    await expect(deleteForum(9)).resolves.toEqual({ ok: true });
    expect(prismaMock.forumTopic.updateMany).toHaveBeenCalledWith({
      where: { forumId: 9 },
      data: { forumId: 1 }
    });
    expect(prismaMock.forum.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        numTopics: { increment: 4 },
        numPosts: { increment: 12 }
      }
    });
  });
});

describe('castVote', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') return arg(mockTx);
      return Promise.all(arg as Promise<unknown>[]);
    });
  });

  it('returns not_found, insufficient_class, and closed reasons', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValueOnce(null);
    await expect(castVote(1, 7, 100, 0)).resolves.toEqual({
      ok: false,
      reason: 'not_found'
    });

    prismaMock.forumPoll.findUnique.mockResolvedValueOnce({
      answers: '["Yes","No"]',
      closed: false,
      forumTopic: { deletedAt: null, forum: { minClassRead: 500 } }
    });
    await expect(castVote(1, 7, 100, 0)).resolves.toEqual({
      ok: false,
      reason: 'insufficient_class'
    });

    prismaMock.forumPoll.findUnique.mockResolvedValueOnce({
      answers: '["Yes","No"]',
      closed: true,
      forumTopic: { deletedAt: null, forum: { minClassRead: 0 } }
    });
    await expect(castVote(1, 7, 100, 0)).resolves.toEqual({
      ok: false,
      reason: 'closed'
    });
  });

  it('rejects invalid answers payloads and invalid vote indexes', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValueOnce({
      answers: 'not-json',
      closed: false,
      forumTopic: { deletedAt: null, forum: { minClassRead: 0 } }
    });
    await expect(castVote(1, 7, 100, 0)).resolves.toEqual({
      ok: false,
      reason: 'invalid_vote'
    });

    prismaMock.forumPoll.findUnique.mockResolvedValueOnce({
      answers: '["Yes"]',
      closed: false,
      forumTopic: { deletedAt: null, forum: { minClassRead: 0 } }
    });
    await expect(castVote(1, 7, 100, 2)).resolves.toEqual({
      ok: false,
      reason: 'invalid_vote'
    });
  });

  it('upserts a valid vote', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue({
      answers: '["Yes","No"]',
      closed: false,
      forumTopic: { deletedAt: null, forum: { minClassRead: 0 } }
    });
    prismaMock.forumPollVote.upsert.mockResolvedValue({
      forumPollId: 1,
      userId: 7,
      vote: 1
    });

    await expect(castVote(1, 7, 100, 1)).resolves.toEqual({
      ok: true,
      vote: { forumPollId: 1, userId: 7, vote: 1 }
    });
    expect(prismaMock.forumPollVote.upsert).toHaveBeenCalledWith({
      where: { forumPollId_userId: { forumPollId: 1, userId: 7 } },
      create: { forumPollId: 1, userId: 7, vote: 1 },
      update: { vote: 1 }
    });
  });
});
