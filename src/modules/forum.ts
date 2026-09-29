import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { translatePrismaError } from '../lib/prismaErrors';
import { sanitizeHtml, sanitizePlain } from '../lib/sanitize';
import { canAccessForumLevel } from '../lib/userRankAccess';
import {
  emitNotifications,
  extractMentionedUsernames,
  extractNewMentionedUsernames
} from '../lib/notifications';
import { registerBBCodeImages } from './remoteImage';

type DeleteForumResult =
  { ok: true } | { ok: false; reason: 'not_found' | 'is_trash' | 'no_trash' };

type CastVoteResult =
  | { ok: true; vote: Awaited<ReturnType<typeof prisma.forumPollVote.upsert>> }
  | {
      ok: false;
      reason: 'not_found' | 'insufficient_class' | 'closed' | 'invalid_vote';
    };

/**
 * The one guard this file's `forum.update`s need (#752, ADR-0048). `Forum` is
 * the only forum model ever hard-deleted, by `deleteForum`, so a path
 * `forumId` checked before the transaction can name nothing by the time it is
 * written. Topics, posts and polls are never hard-deleted, and
 * noHardDelete.spec.ts keeps it so.
 */
const FORUM_GONE = { P2025: [404, 'Forum not found'] } as const;

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
    orderBy: [{ lastPost: { createdAt: 'desc' } }, { id: 'asc' }],
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
) => {
  const body = sanitizeHtml(data.body);
  // Before the write, so a 429 refuses the topic whole (#737).
  await registerBBCodeImages(body, authorId);
  return prisma.$transaction(async (tx) => {
    let topic;
    try {
      topic = await tx.forumTopic.create({
        data: { title: data.title, forumId, authorId }
      });
    } catch (err) {
      translatePrismaError(err, { P2003: [404, 'Forum not found'] });
    }
    const post = await tx.forumPost.create({
      data: { forumTopicId: topic.id, authorId, body }
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
};

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
    try {
      await tx.forum.update({
        where: { id: forumId },
        data: {
          numTopics: { decrement: 1 },
          numPosts: { decrement: livePostCount }
        }
      });
    } catch (err) {
      translatePrismaError(err, FORUM_GONE);
    }
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

/**
 * Tell a new post's topic subscribers, and anyone it quotes. Through
 * `emitNotifications`, not a direct write, so a recipient who cannot read this
 * forum is not notified (#695). It drops the author.
 */
const notifyNewPost = async (
  tx: Tx,
  post: { forumTopicId: number; authorId: number; postId: number; body: string }
) => {
  const target = {
    actorId: post.authorId,
    page: 'forums',
    pageId: post.forumTopicId,
    postId: post.postId
  } as const;
  const subs = await tx.subscription.findMany({
    where: { topicId: post.forumTopicId },
    select: { userId: true }
  });
  await emitNotifications(tx, {
    ...target,
    userIds: subs.map((s) => s.userId),
    type: 'forum_sub'
  });

  const quotedUsernames = extractMentionedUsernames(post.body);
  if (quotedUsernames.length === 0) return;
  const quotedUsers = await tx.user.findMany({
    where: {
      username: { in: quotedUsernames, mode: 'insensitive' },
      disabled: false
    },
    select: { id: true }
  });
  await emitNotifications(tx, {
    ...target,
    userIds: quotedUsers.map((u) => u.id),
    type: 'forum_quote'
  });
};

export const createPost = async (
  forumId: number,
  forumTopicId: number,
  authorId: number,
  body: string
) => {
  const sanitizedBody = sanitizeHtml(body);
  await registerBBCodeImages(sanitizedBody, authorId);
  return prisma.$transaction(async (tx) => {
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
        try {
          await tx.forum.update({
            where: { id: forumId },
            data: { lastTopicId: forumTopicId }
          });
        } catch (err) {
          translatePrismaError(err, FORUM_GONE);
        }

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
    try {
      await tx.forum.update({
        where: { id: forumId },
        data: { lastTopicId: forumTopicId, numPosts: { increment: 1 } }
      });
    } catch (err) {
      translatePrismaError(err, FORUM_GONE);
    }

    await notifyNewPost(tx, { forumTopicId, authorId, postId: post.id, body });

    return post;
  });
};

export const updatePost = async (
  id: number,
  editorId: number,
  currentBody: string,
  newBody: string,
  forumTopicId: number
) => {
  const body = sanitizeHtml(newBody);
  await registerBBCodeImages(body, editorId);
  return prisma.$transaction(async (tx) => {
    const post = await tx.forumPost.update({
      where: { id },
      data: { body }
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
};

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
    try {
      await tx.forum.update({
        where: { id: forumId },
        data: { numPosts: { decrement: 1 } }
      });
    } catch (err) {
      translatePrismaError(err, FORUM_GONE);
    }
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
    try {
      await tx.forum.update({
        where: { id: topic.forumId },
        data: {
          numTopics: { decrement: 1 },
          numPosts: { decrement: postCount }
        }
      });
    } catch (err) {
      translatePrismaError(err, FORUM_GONE);
    }
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

  try {
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
  } catch (err) {
    // A second delete of the same forum, racing this one (#752). The trash
    // forum is never deleted, so the update above cannot be what vanished.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2025'
    )
      return { ok: false, reason: 'not_found' };
    throw err;
  }
  return { ok: true };
};

export const createPoll = async (
  forumTopicId: number,
  question: string,
  answers: string
) => {
  // `forumTopicId` is unique on ForumPoll: a topic holds one poll, and nothing
  // before this write checked for it (#752).
  try {
    return await prisma.forumPoll.create({
      data: { forumTopicId, question, answers }
    });
  } catch (err) {
    translatePrismaError(err, { P2002: [409, 'Topic already has a poll'] });
  }
};

export const closePoll = async (id: number) =>
  prisma.forumPoll.update({ where: { id }, data: { closed: true } });

type Voter = {
  id: number;
  userRankLevel: number;
  permittedForumIds?: number[];
};
type VoteRefusal = Extract<CastVoteResult, { ok: false }>['reason'];

/** The poll a vote reads, with what `voteRefusal` checks. */
const loadPollForVote = (forumPollId: number) =>
  prisma.forumPoll.findUnique({
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

/** Whether `vote` indexes an answer in the poll's stored JSON array. */
const isValidAnswer = (raw: string, vote: number): boolean => {
  try {
    const answers: unknown = JSON.parse(raw);
    return Array.isArray(answers) && vote < answers.length;
  } catch {
    return false;
  }
};

/** Why this vote is refused, or null when it may be recorded. */
const voteRefusal = (
  poll: Awaited<ReturnType<typeof loadPollForVote>>,
  user: Voter,
  vote: number
): VoteRefusal | null => {
  if (!poll || poll.forumTopic?.deletedAt) return 'not_found';
  const forumId = poll.forumTopic?.forumId ?? 0;
  if (!canAccessForumLevel(user, forumId, poll.forumTopic?.forum.minClassRead))
    return 'insufficient_class';
  if (poll.closed) return 'closed';
  return isValidAnswer(poll.answers, vote) ? null : 'invalid_vote';
};

/**
 * Record or change one member's vote. Two concurrent votes by one member can
 * both miss the row and both insert; the second loses on the unique key (#752).
 */
const recordVote = async (
  forumPollId: number,
  userId: number,
  vote: number
) => {
  try {
    return await prisma.forumPollVote.upsert({
      where: { forumPollId_userId: { forumPollId, userId } },
      create: { forumPollId, userId, vote },
      update: { vote }
    });
  } catch (err) {
    translatePrismaError(err, {
      P2002: [409, 'Your vote was being recorded already; try again']
    });
  }
};

export const castVote = async (
  forumPollId: number,
  userOrId: Voter | number,
  userRankLevelOrVote: number,
  maybeVote?: number
): Promise<CastVoteResult> => {
  const user: Voter =
    typeof userOrId === 'number'
      ? {
          id: userOrId,
          userRankLevel: userRankLevelOrVote,
          permittedForumIds: []
        }
      : userOrId;
  const vote =
    typeof userOrId === 'number' ? (maybeVote ?? 0) : userRankLevelOrVote;

  const refusal = voteRefusal(await loadPollForVote(forumPollId), user, vote);
  if (refusal) return { ok: false, reason: refusal };
  return { ok: true, vote: await recordVote(forumPollId, user.id, vote) };
};

export const createTopicNote = async (
  forumTopicId: number,
  authorId: number,
  body: string
) => {
  // The topic id comes from the body and nothing checked it (#752). `authorId`
  // is the session's, so a P2003 can only mean the topic.
  try {
    return await prisma.forumTopicNote.create({
      data: { forumTopicId, authorId, body }
    });
  } catch (err) {
    translatePrismaError(err, { P2003: [400, 'Topic not found'] });
  }
};
