import { prisma } from '../lib/prisma';
import { sanitizeHtml, sanitizePlain } from '../lib/sanitize';
import { canAccessForumLevel } from '../lib/userRankAccess';
import {
  emitNotifications,
  extractMentionedUsernames,
  extractNewMentionedUsernames
} from '../lib/notifications';

type DeleteForumResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'is_trash' | 'no_trash' };

type CastVoteResult =
  | { ok: true; vote: Awaited<ReturnType<typeof prisma.forumPollVote.upsert>> }
  | {
      ok: false;
      reason: 'not_found' | 'insufficient_class' | 'closed' | 'invalid_vote';
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
  await prisma.$transaction([
    prisma.forumTopic.update({
      where: { id },
      data: { deletedAt: new Date() }
    }),
    prisma.forum.update({
      where: { id: forumId },
      data: {
        numTopics: { decrement: 1 },
        numPosts: { decrement: livePostCount }
      }
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: isModAction ? 'topic.mod_delete' : 'topic.delete',
        targetType: 'ForumTopic',
        targetId: id
      }
    })
  ]);
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

  const sourceForum = await prisma.forum.findUnique({
    where: { id: topic.forumId },
    select: { lastTopicId: true }
  });

  const updated = await prisma.$transaction(async (tx) => {
    // If this topic was the forum's latest, find the next most recent one
    if (sourceForum?.lastTopicId === id) {
      const nextTopic = await tx.forumTopic.findFirst({
        where: { forumId: topic.forumId, id: { not: id } },
        orderBy: { createdAt: 'desc' },
        select: { id: true }
      });
      await tx.forum.update({
        where: { id: topic.forumId },
        data: {
          numTopics: { decrement: 1 },
          numPosts: { decrement: postCount },
          lastTopicId: nextTopic?.id ?? null
        }
      });
    } else {
      await tx.forum.update({
        where: { id: topic.forumId },
        data: {
          numTopics: { decrement: 1 },
          numPosts: { decrement: postCount }
        }
      });
    }
    await tx.forum.update({
      where: { id: trash.id },
      data: { numTopics: { increment: 1 }, numPosts: { increment: postCount } }
    });
    return tx.forumTopic.update({
      where: { id },
      data: { forumId: trash.id, isSticky: false }
    });
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
    typeof userOrId === 'number' ? maybeVote ?? 0 : userRankLevelOrVote;

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
