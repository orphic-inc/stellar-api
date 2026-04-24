import { prisma } from '../lib/prisma';
import { sanitizeHtml, sanitizePlain } from '../lib/sanitize';
import { appendToJsonArray } from '../lib/jsonHelpers';

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
