// #598 — the denormalized last-pointer recomputes, tested against the MODULE.
//
// Deliberately not through a route. The same change adds `deletedAt: null` to
// the includes that read these pointers, and that filter would mask a broken
// recompute completely: a stale pointer and a correct one both render as the
// absence of a deleted row. Only asserting the write proves the pointer moved.
//
// The harness mocks modules/forum wholesale, so this file mocks lib/prisma
// directly instead — the per-file pattern AGENTS.md documents for module specs.

// modules/forum reaches isomorphic-dompurify through lib/sanitize, which is
// ESM and cannot load under this jest transform. Neither module is on the path
// under test — the recomputes touch no user input.
jest.mock('./lib/sanitize', () => ({
  sanitizeHtml: (s: string) => s,
  sanitizePlain: (s: string) => s
}));
jest.mock('./lib/notifications', () => ({
  emitNotifications: jest.fn(),
  extractMentionedUsernames: () => [],
  extractNewMentionedUsernames: () => []
}));

const tx = {
  forumPost: { update: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
  forumTopic: { update: jest.fn(), findFirst: jest.fn() },
  forum: { update: jest.fn() },
  auditLog: { create: jest.fn() }
};

const mockTransaction = jest.fn(async (cb: unknown) =>
  (cb as (c: typeof tx) => Promise<unknown>)(tx)
);
const mockPostCount = jest.fn();
const mockTopicFindFirst = jest.fn();
const mockForumFindFirst = jest.fn();
const mockPostCountTop = jest.fn();

jest.mock('./lib/prisma', () => ({
  prisma: {
    $transaction: mockTransaction,
    forumPost: { count: mockPostCount },
    forumTopic: { findFirst: mockTopicFindFirst },
    forum: { findFirst: mockForumFindFirst, findUnique: jest.fn() }
  }
}));

import { deleteTopic, deletePost, trashTopic } from './modules/forum';

beforeEach(() => {
  // jest.config.cjs sets resetMocks, which strips the implementation off a
  // jest.fn() declared at module scope — including the one that runs the
  // interactive-transaction callback. Re-establish it per test.
  mockTransaction.mockImplementation(async (cb: unknown) =>
    (cb as (c: typeof tx) => Promise<unknown>)(tx)
  );
  mockPostCount.mockResolvedValue(0);
  mockPostCountTop.mockResolvedValue(0);
  tx.forumPost.count.mockResolvedValue(1);
  tx.forumPost.findFirst.mockResolvedValue(null);
  tx.forumTopic.findFirst.mockResolvedValue(null);
  tx.forumTopic.update.mockResolvedValue({ id: 44 });
});

/** The forum-pointer write, or undefined if none was made. */
const forumPointerWrite = () =>
  tx.forum.update.mock.calls
    .map((c) => c[0] as { data?: Record<string, unknown> })
    .find((a) => a.data && 'lastTopicId' in a.data);

const topicPointerWrite = () =>
  tx.forumTopic.update.mock.calls
    .map((c) => c[0] as { data?: Record<string, unknown> })
    .find((a) => a.data && 'lastPostId' in a.data);

describe('deleteTopic repoints the forum (#598)', () => {
  it('moves lastTopicId to the topic with the newest live post', async () => {
    tx.forumTopic.findFirst.mockResolvedValueOnce({ id: 77 });

    await deleteTopic(44, 9, 3, false);

    expect(forumPointerWrite()?.data?.lastTopicId).toBe(77);
  });

  it('orders by the newest live POST, not by topic createdAt', async () => {
    // The column means "topic with the most recent activity" — createPost sets
    // it on every post. Ordering by creation would surface a quiet new thread
    // over an old one replied to an hour ago.
    tx.forumTopic.findFirst.mockResolvedValueOnce({ id: 77 });

    await deleteTopic(44, 9, 3, false);

    expect(tx.forumTopic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { forumId: 9, deletedAt: null, lastPostId: { not: null } },
        orderBy: [{ lastPost: { createdAt: 'desc' } }, { id: 'asc' }]
      })
    );
  });

  it('never repoints at another soft-deleted topic', async () => {
    await deleteTopic(44, 9, 3, false);

    for (const call of tx.forumTopic.findFirst.mock.calls) {
      const where = (call[0] as { where: Record<string, unknown> }).where;
      expect(where).toMatchObject({ deletedAt: null });
    }
  });

  it('falls back to createdAt when no live topic has a live post', async () => {
    // Reachable only with rows already stale in a deployed database. A forum
    // holding live topics must not render a blank last-topic column.
    tx.forumTopic.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 55 });

    await deleteTopic(44, 9, 3, false);

    expect(tx.forumTopic.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.forumTopic.findFirst.mock.calls[1][0]).toMatchObject({
      where: { forumId: 9, deletedAt: null },
      orderBy: { createdAt: 'desc' }
    });
    expect(forumPointerWrite()?.data?.lastTopicId).toBe(55);
  });

  it('nulls the pointer when the forum has no live topics left', async () => {
    await deleteTopic(44, 9, 3, false);

    expect(forumPointerWrite()?.data?.lastTopicId).toBeNull();
  });
});

describe('deletePost repoints the topic and the forum (#598)', () => {
  it('moves lastPostId to the newest remaining live post', async () => {
    tx.forumPost.findFirst.mockResolvedValueOnce({ id: 12 });

    await deletePost(21, 44, 9, 3, false);

    expect(topicPointerWrite()?.data?.lastPostId).toBe(12);
  });

  it('never repoints at another soft-deleted post', async () => {
    // Added after breaking the guard: dropping `deletedAt: null` from the
    // post-side query passed every other test in this file, because they only
    // inspected the topic-side query.
    await deletePost(21, 44, 9, 3, false);

    expect(tx.forumPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { forumTopicId: 44, deletedAt: null }
      })
    );
  });

  it('nulls lastPostId when the deleted post was the last live one', async () => {
    tx.forumPost.count.mockResolvedValue(0);

    await deletePost(21, 44, 9, 3, false);

    expect(topicPointerWrite()?.data?.lastPostId).toBeNull();
  });

  it('repoints the forum even when the topic survives', async () => {
    // Deleting the newest post reorders the forum by activity whether or not
    // the topic itself goes, because the ordering reads lastPost.
    tx.forumPost.count.mockResolvedValue(3);
    tx.forumPost.findFirst.mockResolvedValueOnce({ id: 12 });
    tx.forumTopic.findFirst.mockResolvedValueOnce({ id: 77 });

    await deletePost(21, 44, 9, 3, false);

    expect(forumPointerWrite()?.data?.lastTopicId).toBe(77);
  });

  it('recomputes the topic pointer BEFORE the cascade soft-deletes it', async () => {
    // Order matters: the forum ordering below reads lastPost, so a stale topic
    // pointer would feed the forum recompute a deleted post.
    tx.forumPost.count.mockResolvedValue(0);

    await deletePost(21, 44, 9, 3, false);

    const order = tx.forumTopic.update.mock.calls.map((c) =>
      Object.keys((c[0] as { data: Record<string, unknown> }).data)
    );
    const pointerAt = order.findIndex((k) => k.includes('lastPostId'));
    const deleteAt = order.findIndex((k) => k.includes('deletedAt'));
    expect(pointerAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThanOrEqual(0);
    expect(pointerAt).toBeLessThan(deleteAt);
  });
});

describe('trashTopic repoints the source forum (#598)', () => {
  const topic = { id: 44, forumId: 9, deletedAt: null };

  beforeEach(() => {
    mockTopicFindFirst.mockResolvedValue(topic);
    mockForumFindFirst.mockResolvedValue({ id: 2, isTrash: true });
    mockPostCount.mockResolvedValue(4);
  });

  it('repoints the source forum after the move, filtering deleted topics', async () => {
    // trashTopic already recomputed before #598 — it was the worked example
    // the delete paths were missing. It ordered by topic createdAt and did NOT
    // filter deletedAt, so it could repoint a forum at a soft-deleted topic.
    tx.forumTopic.findFirst.mockResolvedValueOnce({ id: 77 });

    const res = await trashTopic(44);

    expect(res.ok).toBe(true);
    expect(tx.forumTopic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { forumId: 9, deletedAt: null, lastPostId: { not: null } }
      })
    );
    expect(forumPointerWrite()?.data?.lastTopicId).toBe(77);
  });

  it('still returns the moved topic', async () => {
    tx.forumTopic.update.mockResolvedValue({ id: 44, forumId: 2 });

    const res = await trashTopic(44);

    expect(res).toEqual({ ok: true, topic: { id: 44, forumId: 2 } });
  });
});
