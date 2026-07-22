// ─── Mocks (must be before imports) ──────────────────────────────────────────

const mockTx = {
  forumPost: {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn()
  },
  forumTopic: {
    findFirst: jest.fn()
  },
  forumPoll: {
    findUnique: jest.fn()
  },
  subscription: {
    findUnique: jest.fn()
  },
  forumLastReadTopic: {
    upsert: jest.fn()
  }
};

jest.mock('../lib/prisma', () => ({
  prisma: {
    forum: {
      findUnique: jest.fn()
    },
    forumTopic: {
      findFirst: jest.fn()
    },
    forumPost: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn()
    },
    forumPoll: {
      findUnique: jest.fn()
    },
    subscription: {
      findUnique: jest.fn()
    },
    forumLastReadTopic: {
      upsert: jest.fn()
    },
    $transaction: jest.fn((arg: unknown) => {
      if (typeof arg === 'function') return arg(mockTx);
      return Promise.all(arg as Promise<unknown>[]);
    })
  }
}));

jest.mock('./forum', () => ({
  createPost: jest.fn(),
  updateTopic: jest.fn(),
  deleteTopic: jest.fn(),
  trashTopic: jest.fn(),
  castVote: jest.fn()
}));

jest.mock('../lib/sanitize', () => ({
  sanitizeHtml: (v: string) => v,
  sanitizePlain: (v: string) => v
}));

// bbcodeRender → bbcode/sanitizeConfig eagerly loads isomorphic-dompurify (jsdom
// ESM), which jest can't parse. Stub the sanitizer; render output is covered by
// bbcode.spec.ts.
jest.mock('../lib/bbcode/sanitizeConfig', () => ({
  sanitizeBBCode: (v: string) => v
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { prisma } from '../lib/prisma';
import { makeForumTopic } from '../test/factories';
import {
  createPost as forumCreatePost,
  updateTopic as forumUpdateTopic,
  deleteTopic as forumDeleteTopic,
  trashTopic as forumTrashTopic,
  castVote
} from './forum';
import {
  getTopicSession,
  updateTopic,
  deleteTopic,
  trashTopic,
  replyToTopic,
  voteTopicPoll,
  markTopicRead
} from './topicSession';

// ─── Typed mocks ─────────────────────────────────────────────────────────────

const prismaMock = prisma as unknown as {
  forum: { findUnique: jest.Mock };
  forumTopic: { findFirst: jest.Mock };
  forumPost: { findMany: jest.Mock; count: jest.Mock; findFirst: jest.Mock };
  forumPoll: { findUnique: jest.Mock };
  subscription: { findUnique: jest.Mock };
  forumLastReadTopic: { upsert: jest.Mock };
  $transaction: jest.Mock;
};
const createPostForumMock = forumCreatePost as jest.Mock;
const updateTopicForumMock = forumUpdateTopic as jest.Mock;
const deleteTopicForumMock = forumDeleteTopic as jest.Mock;
const trashTopicForumMock = forumTrashTopic as jest.Mock;
const castVoteMock = castVote as jest.Mock;

const baseActor = {
  actorId: 7,
  userRankLevel: 1000,
  permittedForumIds: [],
  canModerateForums: false
};

const basePg = { page: 1, limit: 25, skip: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.$transaction.mockImplementation((arg: unknown) => {
    if (typeof arg === 'function') return arg(mockTx);
    return Promise.all(arg as Promise<unknown>[]);
  });
});

// ─── getTopicSession ──────────────────────────────────────────────────────────

describe('getTopicSession', () => {
  const mockForum = {
    id: 9,
    name: 'Open Forum',
    forumCategoryId: 1,
    forumCategory: { id: 1, name: 'General' },
    minClassRead: 0,
    minClassWrite: 0,
    minClassCreate: 0
  };
  const mockTopic = {
    id: 44,
    title: 'Test Topic',
    forumId: 9,
    authorId: 5,
    isLocked: false,
    isSticky: false,
    numPosts: 2,
    deletedAt: null,
    author: { id: 5, username: 'alice', avatar: null },
    notes: []
  };

  beforeEach(() => {
    prismaMock.forum.findUnique.mockResolvedValue(mockForum);
    prismaMock.forumTopic.findFirst.mockResolvedValue(mockTopic);
    prismaMock.forumPost.findMany.mockResolvedValue([]);
    prismaMock.forumPost.count.mockResolvedValue(0);
    prismaMock.forumPoll.findUnique.mockResolvedValue(null);
    prismaMock.subscription.findUnique.mockResolvedValue(null);
  });

  it('returns the session view model with forum, topic, posts, poll, subscription, affordances, and readState', async () => {
    const result = await getTopicSession(9, 44, baseActor, basePg);

    expect(result.forum.name).toBe('Open Forum');
    expect(result.topic.title).toBe('Test Topic');
    expect(result.posts.data).toEqual([]);
    expect(result.posts.meta.total).toBe(0);
    expect(result.poll).toBeNull();
    expect(result.subscription.isSubscribed).toBe(false);
    expect(result.affordances).toMatchObject({
      canReply: true,
      canModerate: false,
      canVoteInPoll: false,
      canSubscribe: true,
      canCatchUp: true
    });
    expect(result.readState.lastVisiblePostId).toBeNull();
  });

  it('throws 404 when forum is not found', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(null);

    await expect(
      getTopicSession(99, 44, baseActor, basePg)
    ).rejects.toMatchObject({
      statusCode: 404,
      message: 'Forum not found'
    });
  });

  it('throws 403 when user rank is below minClassRead', async () => {
    prismaMock.forum.findUnique.mockResolvedValue({
      ...mockForum,
      minClassRead: 500
    });

    await expect(
      getTopicSession(9, 44, { ...baseActor, userRankLevel: 10 }, basePg)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws 404 when topic is not found', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue(null);

    await expect(
      getTopicSession(9, 99, baseActor, basePg)
    ).rejects.toMatchObject({
      statusCode: 404,
      message: 'Topic not found'
    });
  });

  it('sets subscription.isSubscribed=true when a subscription record exists', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      id: 1,
      userId: 7,
      topicId: 44
    });

    const result = await getTopicSession(9, 44, baseActor, basePg);

    expect(result.subscription.isSubscribed).toBe(true);
  });

  it('sets readState.lastVisiblePostId to the last post id on the page', async () => {
    prismaMock.forumPost.findMany.mockResolvedValue([
      {
        id: 21,
        forumTopicId: 44,
        authorId: 5,
        body: 'A',
        edits: [],
        author: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 22,
        forumTopicId: 44,
        authorId: 5,
        body: 'B',
        edits: [],
        author: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ] as never);
    prismaMock.forumPost.count.mockResolvedValue(2);

    const result = await getTopicSession(9, 44, baseActor, basePg);

    expect(result.readState.lastVisiblePostId).toBe(22);
  });

  it('sets canVoteInPoll=true when the poll is open and the user has not voted', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue({
      id: 1,
      forumTopicId: 44,
      question: 'Q?',
      answers: '["A","B"]',
      closed: false,
      votes: []
    });

    const result = await getTopicSession(9, 44, baseActor, basePg);

    expect(result.affordances.canVoteInPoll).toBe(true);
  });

  it('sets canVoteInPoll=false when the poll is closed', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue({
      id: 1,
      forumTopicId: 44,
      question: 'Q?',
      answers: '["A","B"]',
      closed: true,
      votes: []
    });

    const result = await getTopicSession(9, 44, baseActor, basePg);

    expect(result.affordances.canVoteInPoll).toBe(false);
  });

  it('sets canVoteInPoll=false when the actor has already voted', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue({
      id: 1,
      forumTopicId: 44,
      question: 'Q?',
      answers: '["A","B"]',
      closed: false,
      votes: [{ id: 1, forumPollId: 1, userId: 7, vote: 0 }]
    });

    const result = await getTopicSession(9, 44, baseActor, basePg);

    expect(result.affordances.canVoteInPoll).toBe(false);
  });

  it('sets canReply=false when topic is locked and actor cannot moderate', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue({
      ...mockTopic,
      isLocked: true
    });

    const result = await getTopicSession(9, 44, baseActor, basePg);

    expect(result.affordances.canReply).toBe(false);
  });

  it('sets canReply=true when topic is locked but actor is a moderator', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue({
      ...mockTopic,
      isLocked: true
    });

    const result = await getTopicSession(
      9,
      44,
      { ...baseActor, canModerateForums: true },
      basePg
    );

    expect(result.affordances.canReply).toBe(true);
    expect(result.affordances.canModerate).toBe(true);
  });
});

// ─── updateTopic ──────────────────────────────────────────────────────────────

describe('updateTopic', () => {
  it('returns not_found when the topic does not exist', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue(null);

    const result = await updateTopic(99, 9, baseActor, { title: 'X' });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_authorized for a non-owner without moderator rights', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue({
      id: 44,
      authorId: 99 // someone else
    } as never);

    const result = await updateTopic(44, 9, baseActor, { title: 'X' });

    expect(result).toEqual({ ok: false, reason: 'not_authorized' });
    expect(updateTopicForumMock).not.toHaveBeenCalled();
  });

  it('allows the topic owner to update', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue({
      id: 44,
      authorId: 7
    } as never);
    updateTopicForumMock.mockResolvedValue({ id: 44, title: 'New Title' });

    const result = await updateTopic(44, 9, baseActor, { title: 'New Title' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.topic.title).toBe('New Title');
    expect(updateTopicForumMock).toHaveBeenCalledWith(44, {
      title: 'New Title'
    });
  });

  it('allows a moderator to update any topic', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue({
      id: 44,
      authorId: 99
    } as never);
    updateTopicForumMock.mockResolvedValue({ id: 44, isLocked: true });

    const result = await updateTopic(
      44,
      9,
      { ...baseActor, canModerateForums: true },
      { isLocked: true }
    );

    expect(result.ok).toBe(true);
    expect(updateTopicForumMock).toHaveBeenCalledWith(44, { isLocked: true });
  });
});

// ─── deleteTopic ──────────────────────────────────────────────────────────────

describe('deleteTopic', () => {
  it('returns not_found when the topic does not exist', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue(null);

    const result = await deleteTopic(99, 9, baseActor);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_authorized for a non-owner without moderator rights', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue({
      id: 44,
      forumId: 9,
      authorId: 99
    } as never);

    const result = await deleteTopic(44, 9, baseActor);

    expect(result).toEqual({ ok: false, reason: 'not_authorized' });
    expect(deleteTopicForumMock).not.toHaveBeenCalled();
  });

  it('calls forum.deleteTopic with isModAction=false for the owner', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue({
      id: 44,
      forumId: 9,
      authorId: 7
    } as never);
    deleteTopicForumMock.mockResolvedValue(undefined);

    const result = await deleteTopic(44, 9, baseActor);

    expect(result).toEqual({ ok: true });
    expect(deleteTopicForumMock).toHaveBeenCalledWith(44, 9, 7, false);
  });

  it('calls forum.deleteTopic with isModAction=true for a moderator', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue({
      id: 44,
      forumId: 9,
      authorId: 99
    } as never);
    deleteTopicForumMock.mockResolvedValue(undefined);

    const result = await deleteTopic(44, 9, {
      ...baseActor,
      canModerateForums: true
    });

    expect(result).toEqual({ ok: true });
    expect(deleteTopicForumMock).toHaveBeenCalledWith(44, 9, 7, true);
  });
});

// ─── trashTopic ──────────────────────────────────────────────────────────────

describe('trashTopic', () => {
  it('returns not_authorized immediately for non-moderators', async () => {
    const result = await trashTopic(44, 9, baseActor);

    expect(result).toEqual({ ok: false, reason: 'not_authorized' });
    expect(prismaMock.forumTopic.findFirst).not.toHaveBeenCalled();
  });

  it('returns not_found when the topic does not exist in the given forum', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue(null);

    const result = await trashTopic(99, 9, {
      ...baseActor,
      canModerateForums: true
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(trashTopicForumMock).not.toHaveBeenCalled();
  });

  it('delegates to forum.trashTopic and returns ok on success', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue({
      id: 44,
      forumId: 9
    } as never);
    trashTopicForumMock.mockResolvedValue({
      ok: true,
      topic: { id: 44, forumId: 1 }
    });

    const result = await trashTopic(44, 9, {
      ...baseActor,
      canModerateForums: true
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.topic.id).toBe(44);
    expect(trashTopicForumMock).toHaveBeenCalledWith(44);
  });

  it('forwards no_trash and already_trash reasons from forum.trashTopic', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue({
      id: 44,
      forumId: 9
    } as never);
    trashTopicForumMock.mockResolvedValue({ ok: false, reason: 'no_trash' });

    const result = await trashTopic(44, 9, {
      ...baseActor,
      canModerateForums: true
    });

    expect(result).toEqual({ ok: false, reason: 'no_trash' });
  });
});

// ─── replyToTopic ─────────────────────────────────────────────────────────────

describe('replyToTopic', () => {
  it('throws 404 when the forum does not exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(null);
    prismaMock.forumTopic.findFirst.mockResolvedValue(null);

    await expect(replyToTopic(9, 44, baseActor, 'Hello')).rejects.toMatchObject(
      {
        statusCode: 404,
        message: 'Forum not found'
      }
    );
  });

  it('throws 404 when the topic does not exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue({ id: 9 });
    prismaMock.forumTopic.findFirst.mockResolvedValue(null);

    await expect(replyToTopic(9, 44, baseActor, 'Hello')).rejects.toMatchObject(
      {
        statusCode: 404,
        message: 'Forum topic not found'
      }
    );
  });

  it('throws 403 when the topic is locked and actor cannot moderate', async () => {
    prismaMock.forum.findUnique.mockResolvedValue({ id: 9 });
    prismaMock.forumTopic.findFirst.mockResolvedValue(
      makeForumTopic({ id: 44, forumId: 9, isLocked: true })
    );

    await expect(
      replyToTopic(9, 44, { ...baseActor, canModerateForums: false }, 'Hello')
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows a moderator to reply to a locked topic', async () => {
    prismaMock.forum.findUnique.mockResolvedValue({ id: 9 });
    prismaMock.forumTopic.findFirst.mockResolvedValue(
      makeForumTopic({ id: 44, forumId: 9, isLocked: true })
    );
    createPostForumMock.mockResolvedValue({ id: 31 });

    await replyToTopic(
      9,
      44,
      { ...baseActor, canModerateForums: true },
      'Hello'
    );

    expect(createPostForumMock).toHaveBeenCalledWith(9, 44, 7, 'Hello');
  });

  it('delegates to forum.createPost when the topic is unlocked', async () => {
    prismaMock.forum.findUnique.mockResolvedValue({ id: 9 });
    prismaMock.forumTopic.findFirst.mockResolvedValue(
      makeForumTopic({ id: 44, forumId: 9, isLocked: false })
    );
    createPostForumMock.mockResolvedValue({ id: 31 });

    await replyToTopic(9, 44, baseActor, 'Hello');

    expect(createPostForumMock).toHaveBeenCalledWith(9, 44, 7, 'Hello');
  });
});

// ─── voteTopicPoll ────────────────────────────────────────────────────────────

describe('voteTopicPoll', () => {
  it('delegates to forum.castVote with a proper user shape', async () => {
    castVoteMock.mockResolvedValue({ ok: true, vote: { id: 1, vote: 0 } });

    await voteTopicPoll(1, baseActor, 0);

    expect(castVoteMock).toHaveBeenCalledWith(
      1,
      { id: 7, userRankLevel: 1000, permittedForumIds: [] },
      0
    );
  });
});

// ─── markTopicRead ────────────────────────────────────────────────────────────

describe('markTopicRead', () => {
  const mockPost = {
    id: 21,
    forumTopicId: 44,
    deletedAt: null,
    forumTopic: {
      forumId: 9,
      forum: { minClassRead: 0 }
    }
  };

  it('throws 404 when the post does not exist', async () => {
    prismaMock.forumPost.findFirst.mockResolvedValue(null);

    await expect(markTopicRead(44, 99, baseActor)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('throws 403 when the user rank is below minClassRead', async () => {
    prismaMock.forumPost.findFirst.mockResolvedValue({
      ...mockPost,
      forumTopic: { forumId: 9, forum: { minClassRead: 500 } }
    } as never);

    await expect(
      markTopicRead(44, 21, { ...baseActor, userRankLevel: 10 })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('upserts the last-read record and returns it', async () => {
    prismaMock.forumPost.findFirst.mockResolvedValue(mockPost as never);
    prismaMock.forumLastReadTopic.upsert.mockResolvedValue({
      id: 1,
      userId: 7,
      forumTopicId: 44,
      forumPostId: 21
    });

    const result = await markTopicRead(44, 21, baseActor);

    expect(result.forumPostId).toBe(21);
    expect(prismaMock.forumLastReadTopic.upsert).toHaveBeenCalledWith({
      where: { userId_forumTopicId: { userId: 7, forumTopicId: 44 } },
      create: { userId: 7, forumTopicId: 44, forumPostId: 21 },
      update: { forumPostId: 21 }
    });
  });
});
