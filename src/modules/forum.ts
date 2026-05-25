import { prisma } from '../lib/prisma';
import { sanitizeHtml, sanitizePlain } from '../lib/sanitize';

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

    return post;
  });

export const updatePost = async (
  id: number,
  editorId: number,
  currentBody: string,
  newBody: string
) =>
  prisma.$transaction(async (tx) => {
    const post = await tx.forumPost.update({
      where: { id },
      data: { body: sanitizeHtml(newBody) }
    });
    await tx.forumPostEdit.create({
      data: { forumPostId: id, editorId, previousBody: currentBody }
    });
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
  userId: number,
  userRankLevel: number,
  vote: number
): Promise<CastVoteResult> => {
  const poll = await prisma.forumPoll.findUnique({
    where: { id: forumPollId },
    include: {
      forumTopic: {
        select: { deletedAt: true, forum: { select: { minClassRead: true } } }
      }
    }
  });
  if (!poll || poll.forumTopic?.deletedAt)
    return { ok: false, reason: 'not_found' };
  if (userRankLevel < (poll.forumTopic?.forum.minClassRead ?? 0))
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
    where: { forumPollId_userId: { forumPollId, userId } },
    create: { forumPollId, userId, vote },
    update: { vote }
  });
  return { ok: true, vote: result };
};

export const createTopicNote = async (
  forumTopicId: number,
  authorId: number,
  body: string
) => prisma.forumTopicNote.create({ data: { forumTopicId, authorId, body } });
