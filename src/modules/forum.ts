import { prisma } from '../lib/prisma';
import { sanitizeHtml, sanitizePlain } from '../lib/sanitize';
import { canAccessForumLevel } from '../lib/userRankAccess';
import {
  emitNotifications,
  extractMentionedUsernames,
  extractNewMentionedUsernames
} from '../lib/notifications';

type DeleteForumResult =
  { ok: true } | { ok: false; reason: 'not_found' | 'is_trash' | 'no_trash' };

type CastVoteResult =
  | { ok: true; vote: Awaited<ReturnType<typeof prisma.forumPollVote.upsert>> }
  | {
      ok: false;
      reason: 'not_found' | 'insufficient_class' | 'closed' | 'invalid_vote';
    };

/** The interactive-transaction client the recomputes below run on. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * `Forum.lastTopicId` and `ForumTopic.lastPostId` are denormalized pointers,
 * and a SOFT delete leaves them pointing at the row it just hid (#598). The
 * `onDelete: SetNull` on both relations only fires for a hard delete, which
 * never happens here — so without these the forum index renders a deleted
 * topic's title, and the topic list renders a deleted post's whole row, body
 * included.
 *
 * Call AFTER the soft delete inside the same transaction: each re-reads live
 * rows, so the row being removed is already excluded by its own `deletedAt`.
 *
 * Both are `Promise<void>`; neither reads what the other writes, but order
 * still matters in `deletePost` — recompute the topic's pointer first, because
 * the forum's ordering below reads `lastPost`.
 */
const recomputeTopicLastPost = async (tx: Tx, forumTopicId: number) => {
  const next = await tx.forumPost.findFirst({
    where: { forumTopicId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true }
  });
  await tx.forumTopic.update({
    where: { id: forumTopicId },
    data: { lastPostId: next?.id ?? null }
  });
};

/**
 * Ordered by the newest remaining live POST, not by topic `createdAt`, because
 * that is what the column means: `createPost` sets `lastTopicId` to whichever
 * topic just received a post. Ordering by creation would surface a quiet new
 * thread over an old one that was replied to an hour ago.
 *
 * The second pass exists for rows already stale in a deployed database: a live
 * topic whose `lastPostId` points at a deleted post is skipped by the first
 * query, and a forum holding live topics must not render a blank last-topic
 * column. A fresh database never reaches it.
 */
const recomputeForumLastTopic = async (tx: Tx, forumId: number) => {
  const byActivity = await tx.forumTopic.findFirst({
    where: { forumId, deletedAt: null, lastPostId: { not: null } },
    orderBy: { lastPost: { createdAt: 'desc' } },
    select: { id: true }
  });
  const next =
    byActivity ??
    (await tx.forumTopic.findFirst({
      where: { forumId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true }
    }));
  await tx.forum.update({
    where: { id: forumId },
    data: { lastTopicId: next?.id ?? null }
  });
};

export const createTopic = async (
  forumId: number,
  authorId: number,
  data: { title: string; body: string; question?: string; answers?: string }
) =>
  prisma.$transaction(async (tx) => {
    const topic = await tx.forumTopic.create({
      data: { title: data.title, forumId, authorId }
    });
    const post = await tx.forumPost.create({
      data: { forumTopicId: topic.id, authorId, body: sanitizeHtml(data.body) }
    });
    await tx.forumTopic.update({
      where: { id: topic.id },
      data: { lastPostId: post.id, numPosts: 1 }
    });
    await tx.forum.update({
      where: { id: forumId },
      data: {
        lastTopicId: topic.id,
        numTopics: { increment: 1 },
        numPosts: { increment: 1 }
      }
    });
    if (data.question && data.answers) {
      await tx.forumPoll.create({
        data: {
          forumTopicId: topic.id,
          question: sanitizePlain(data.question),
          answers: sanitizePlain(data.answers)
        }
      });
    }
    return topic;
  });

export const deleteTopic = async (
  id: number,
  forumId: number,
  actorId: number,
  isModAction: boolean
) => {
  const livePostCount = await prisma.forumPost.count({
    where: { forumTopicId: id, deletedAt: null }
  });
  // Interactive rather than a batch array (#598): the recompute has to read
  // live rows AFTER this topic is hidden, and a batch cannot read between its
  // own writes. AGENTS.md names this as the case interactive exists for.
  await prisma.$transaction(async (tx) => {
    await tx.forumTopic.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
    await tx.forum.update({
      where: { id: forumId },
      data: {
        numTopics: { decrement: 1 },
        numPosts: { decrement: livePostCount }
      }
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: isModAction ? 'topic.mod_delete' : 'topic.delete',
        targetType: 'ForumTopic',
        targetId: id
      }
    });
    await recomputeForumLastTopic(tx, forumId);
  });
};

export const createPost = async (
  forumId: number,
  forumTopicId: number,
  authorId: number,
  body: string
) =>
  prisma.$transaction(async (tx) => {
    const sanitizedBody = sanitizeHtml(body);

    // If the last post in this topic was made by the same author, append to it
    // instead of creating a new post (prevents consecutive double-posting).
    const topic = await tx.forumTopic.findUnique({
      where: { id: forumTopicId },
      select: { lastPostId: true }
    });
    if (topic?.lastPostId) {
      const lastPost = await tx.forumPost.findUnique({
        where: { id: topic.lastPostId, deletedAt: null },
        select: { id: true, authorId: true, body: true }
      });
      if (lastPost && lastPost.authorId === authorId) {
        const merged = await tx.forumPost.update({
          where: { id: lastPost.id },
          data: { body: `${lastPost.body}\n\n${sanitizedBody}` }
        });

        await tx.forumTopic.update({
          where: { id: forumTopicId },
          data: { lastPostId: lastPost.id }
        });
        await tx.forum.update({
          where: { id: forumId },
          data: { lastTopicId: forumTopicId }
        });

        return merged;
      }
    }

    const post = await tx.forumPost.create({
      data: { forumTopicId, authorId, body: sanitizedBody }
    });
    await tx.forumTopic.update({
      where: { id: forumTopicId },
      data: { lastPostId: post.id, numPosts: { increment: 1 } }
    });
    await tx.forum.update({
      where: { id: forumId },
      data: { lastTopicId: forumTopicId, numPosts: { increment: 1 } }
    });

    const subs = await tx.subscription.findMany({
      where: { topicId: forumTopicId },
      select: { userId: true }
    });
    const notifyUserIds = subs
      .map((s) => s.userId)
      .filter((uid) => uid !== authorId);
    if (notifyUserIds.length > 0) {
      await tx.notification.createMany({
        data: notifyUserIds.map((uid) => ({
          userId: uid,
          type: 'forum_sub' as const,
          actorId: authorId,
          page: 'forums' as const,
          pageId: forumTopicId,
          postId: post.id
        })),
        skipDuplicates: true
      });
    }

    const quotedUsernames = extractMentionedUsernames(body);
    if (quotedUsernames.length > 0) {
      const quotedUsers = await tx.user.findMany({
        where: {
          username: { in: quotedUsernames, mode: 'insensitive' },
          disabled: false
        },
        select: { id: true }
      });
      await emitNotifications(tx, {
        userIds: quotedUsers.map((u) => u.id),
        type: 'forum_quote',
        actorId: authorId,
        page: 'forums',
        pageId: forumTopicId,
        postId: post.id
      });
    }

    return post;
  });

export const updatePost = async (
  id: number,
  editorId: number,
  currentBody: string,
  newBody: string,
  forumTopicId: number
) =>
  prisma.$transaction(async (tx) => {
    const post = await tx.forumPost.update({
      where: { id },
      data: { body: sanitizeHtml(newBody) }
    });
    await tx.forumPostEdit.create({
      data: { forumPostId: id, editorId, previousBody: currentBody }
    });

    const newlyQuotedUsernames = extractNewMentionedUsernames(
      currentBody,
      newBody
    );
    if (newlyQuotedUsernames.length > 0) {
      const quotedUsers = await tx.user.findMany({
        where: {
          username: { in: newlyQuotedUsernames, mode: 'insensitive' },
          disabled: false
        },
        select: { id: true }
      });
      await emitNotifications(tx, {
        userIds: quotedUsers.map((u) => u.id),
        type: 'forum_quote',
        actorId: editorId,
        page: 'forums',
        pageId: forumTopicId,
        postId: id
      });
    }

    return post;
  });

export const deletePost = async (
  id: number,
  forumTopicId: number,
  forumId: number,
  actorId: number,
  isModAction: boolean
) => {
  await prisma.$transaction(async (tx) => {
    await tx.forumPost.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
    await tx.forumTopic.update({
      where: { id: forumTopicId },
      data: { numPosts: { decrement: 1 } }
    });
    await tx.forum.update({
      where: { id: forumId },
      data: { numPosts: { decrement: 1 } }
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: isModAction ? 'post.mod_delete' : 'post.delete',
        targetType: 'ForumPost',
        targetId: id
      }
    });

    // Before the cascade below, so the topic's own pointer is correct whether
    // or not it survives (#598).
    await recomputeTopicLastPost(tx, forumTopicId);

    const remainingPosts = await tx.forumPost.count({
      where: { forumTopicId, deletedAt: null }
    });
    if (remainingPosts === 0) {
      await tx.forumTopic.update({
        where: { id: forumTopicId },
        data: { deletedAt: new Date() }
      });
      await tx.forum.update({
        where: { id: forumId },
        data: { numTopics: { decrement: 1 } }
      });
    }
    // Unconditional: deleting the newest post reorders the forum by activity
    // even when the topic survives, since the ordering reads `lastPost`.
    await recomputeForumLastTopic(tx, forumId);
  });
};

export const updateTopic = async (
  id: number,
  data: { title?: string; isLocked?: boolean; isSticky?: boolean }
) =>
  prisma.forumTopic.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.isLocked !== undefined && { isLocked: data.isLocked }),
      ...(data.isSticky !== undefined && { isSticky: data.isSticky })
    }
  });

type TrashTopicResult =
  | { ok: true; topic: Awaited<ReturnType<typeof updateTopic>> }
  | { ok: false; reason: 'not_found' | 'no_trash' | 'already_trash' };

// Moves a topic to the designated Trash board, transferring topic/post
// counters between the source forum and the trash forum.
export const trashTopic = async (id: number): Promise<TrashTopicResult> => {
  const topic = await prisma.forumTopic.findFirst({
    where: { id, deletedAt: null }
  });
  if (!topic) return { ok: false, reason: 'not_found' };

  const trash = await prisma.forum.findFirst({ where: { isTrash: true } });
  if (!trash) return { ok: false, reason: 'no_trash' };
  if (topic.forumId === trash.id) return { ok: false, reason: 'already_trash' };

  const postCount = await prisma.forumPost.count({
    where: { forumTopicId: id }
  });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.forum.update({
      where: { id: topic.forumId },
      data: {
        numTopics: { decrement: 1 },
        numPosts: { decrement: postCount }
      }
    });
    await tx.forum.update({
      where: { id: trash.id },
      data: { numTopics: { increment: 1 }, numPosts: { increment: postCount } }
    });
    const moved = await tx.forumTopic.update({
      where: { id },
      data: { forumId: trash.id, isSticky: false }
    });
    // This function already recomputed the source forum's pointer — it was the
    // worked example the delete paths were missing. Two things were wrong with
    // it (#598): it ordered by topic `createdAt` rather than by activity, and
    // it did not filter `deletedAt`, so it could repoint the forum at a
    // soft-deleted topic. Running the shared helper AFTER the move puts all
    // three call sites on one shape; the moved topic now carries the trash
    // forum's id, so it is excluded without an explicit `id: { not: id }`.
    await recomputeForumLastTopic(tx, topic.forumId);
    return moved;
  });

  return { ok: true, topic: updated };
};

export const deleteForum = async (id: number): Promise<DeleteForumResult> => {
  const forum = await prisma.forum.findUnique({ where: { id } });
  if (!forum) return { ok: false, reason: 'not_found' };
  if (forum.isTrash) return { ok: false, reason: 'is_trash' };

  const trash = await prisma.forum.findFirst({ where: { isTrash: true } });
  if (!trash) return { ok: false, reason: 'no_trash' };

  const [topicCount, postCount] = await Promise.all([
    prisma.forumTopic.count({ where: { forumId: id } }),
    prisma.forumPost.count({ where: { forumTopic: { forumId: id } } })
  ]);

  await prisma.$transaction([
    prisma.forumTopic.updateMany({
      where: { forumId: id },
      data: { forumId: trash.id }
    }),
    prisma.forum.update({
      where: { id: trash.id },
      data: {
        numTopics: { increment: topicCount },
        numPosts: { increment: postCount }
      }
    }),
    prisma.forum.delete({ where: { id } })
  ]);
  return { ok: true };
};

export const createPoll = async (
  forumTopicId: number,
  question: string,
  answers: string
) => prisma.forumPoll.create({ data: { forumTopicId, question, answers } });

export const closePoll = async (id: number) =>
  prisma.forumPoll.update({ where: { id }, data: { closed: true } });

export const castVote = async (
  forumPollId: number,
  userOrId:
    | {
        id: number;
        userRankLevel: number;
        permittedForumIds?: number[];
      }
    | number,
  userRankLevelOrVote: number,
  maybeVote?: number
): Promise<CastVoteResult> => {
  const user =
    typeof userOrId === 'number'
      ? {
          id: userOrId,
          userRankLevel: userRankLevelOrVote,
          permittedForumIds: []
        }
      : userOrId;
  const vote =
    typeof userOrId === 'number' ? (maybeVote ?? 0) : userRankLevelOrVote;

  const poll = await prisma.forumPoll.findUnique({
    where: { id: forumPollId },
    include: {
      forumTopic: {
        select: {
          deletedAt: true,
          forumId: true,
          forum: { select: { minClassRead: true } }
        }
      }
    }
  });
  if (!poll || poll.forumTopic?.deletedAt)
    return { ok: false, reason: 'not_found' };
  if (
    !canAccessForumLevel(
      user,
      poll.forumTopic?.forumId ?? 0,
      poll.forumTopic?.forum.minClassRead
    )
  )
    return { ok: false, reason: 'insufficient_class' };
  if (poll.closed) return { ok: false, reason: 'closed' };

  let answers: unknown;
  try {
    answers = JSON.parse(poll.answers);
  } catch {
    return { ok: false, reason: 'invalid_vote' };
  }
  if (!Array.isArray(answers) || vote >= answers.length)
    return { ok: false, reason: 'invalid_vote' };

  const result = await prisma.forumPollVote.upsert({
    where: { forumPollId_userId: { forumPollId, userId: user.id } },
    create: { forumPollId, userId: user.id, vote },
    update: { vote }
  });
  return { ok: true, vote: result };
};

export const createTopicNote = async (
  forumTopicId: number,
  authorId: number,
  body: string
) => prisma.forumTopicNote.create({ data: { forumTopicId, authorId, body } });
