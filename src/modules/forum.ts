import { prisma } from '../lib/prisma';
import { sanitizeHtml, sanitizePlain } from '../lib/sanitize';
import { appendToJsonArray } from '../lib/jsonHelpers';

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
    const post = await tx.forumPost.create({
      data: { forumTopicId, authorId, body: sanitizeHtml(body) }
    });
    await tx.forumTopic.update({
      where: { id: forumTopicId },
      data: { lastPostId: post.id, numPosts: { increment: 1 } }
    });
    await tx.forum.update({
      where: { id: forumId },
      data: { lastTopicId: forumTopicId, numPosts: { increment: 1 } }
    });
    return post;
  });

export const updatePost = async (
  id: number,
  editorId: number,
  currentEdits: unknown,
  currentBody: string,
  newBody: string
) =>
  prisma.forumPost.update({
    where: { id },
    data: {
      body: sanitizeHtml(newBody),
      edits: appendToJsonArray(currentEdits, {
        userId: editorId,
        time: new Date().toISOString(),
        previousBody: currentBody
      })
    }
  });

export const deletePost = async (
  id: number,
  forumTopicId: number,
  forumId: number,
  actorId: number,
  isModAction: boolean
) => {
  await prisma.$transaction([
    prisma.forumPost.update({ where: { id }, data: { deletedAt: new Date() } }),
    prisma.forumTopic.update({
      where: { id: forumTopicId },
      data: { numPosts: { decrement: 1 } }
    }),
    prisma.forum.update({
      where: { id: forumId },
      data: { numPosts: { decrement: 1 } }
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: isModAction ? 'post.mod_delete' : 'post.delete',
        targetType: 'ForumPost',
        targetId: id
      }
    })
  ]);
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
