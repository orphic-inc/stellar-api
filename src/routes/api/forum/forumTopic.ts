import express, { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma';
import { asyncHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { isModerator } from '../../../middleware/permissions';
import { validate } from '../../../middleware/validate';
import { writeLimiter } from '../../../middleware/rateLimiter';
import { createTopicSchema, updateTopicSchema } from '../../../schemas/forum';
import { audit } from '../../../lib/audit';
import { parsePage, paginatedResponse } from '../../../lib/pagination';
import { sanitizeHtml, sanitizePlain } from '../../../lib/sanitize';
import forumPostRouter from './forumPost';

const router = express.Router({ mergeParams: true });

router.use('/:forumTopicId/posts', forumPostRouter);

// GET /api/forums/:forumId/topics
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const forumId = parseInt(req.params.forumId);
    if (isNaN(forumId))
      return res.status(400).json({ msg: 'Invalid forum id' });

    const forum = await prisma.forum.findUnique({
      where: { id: forumId },
      select: { minClassRead: true }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (req.user!.userRankLevel < (forum.minClassRead ?? 0)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to read this forum' });
    }

    const pg = parsePage(req);
    const [topics, total] = await Promise.all([
      prisma.forumTopic.findMany({
        where: { forumId, deletedAt: null },
        orderBy: [{ isSticky: 'desc' }, { updatedAt: 'desc' }],
        skip: pg.skip,
        take: pg.limit,
        include: {
          author: { select: { id: true, username: true } },
          lastPost: {
            include: { author: { select: { id: true, username: true } } }
          }
        }
      }),
      prisma.forumTopic.count({ where: { forumId, deletedAt: null } })
    ]);
    paginatedResponse(res, topics, total, pg);
  })
);

// GET /api/forums/:forumId/topics/:forumTopicId
router.get(
  '/:forumTopicId',
  asyncHandler(async (req: Request, res: Response) => {
    const forumId = parseInt(req.params.forumId);
    const id = parseInt(req.params.forumTopicId);
    if (isNaN(forumId) || isNaN(id))
      return res.status(400).json({ msg: 'Invalid topic id' });
    const [forum, topic] = await Promise.all([
      prisma.forum.findUnique({
        where: { id: forumId },
        select: { minClassRead: true }
      }),
      prisma.forumTopic.findFirst({
        where: { id, forumId, deletedAt: null },
        include: {
          author: { select: { id: true, username: true, avatar: true } },
          notes: {
            include: { author: { select: { id: true, username: true } } }
          }
        }
      })
    ]);
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (req.user!.userRankLevel < (forum.minClassRead ?? 0)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to read this forum' });
    }
    if (!topic) return res.status(404).json({ msg: 'Topic not found' });
    res.json(topic);
  })
);

// POST /api/forums/:forumId/topics
router.post(
  '/',
  requireAuth,
  writeLimiter,
  validate(createTopicSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const forumId = parseInt(req.params.forumId);
    const forum = await prisma.forum.findUnique({
      where: { id: forumId },
      select: { id: true, minClassWrite: true, minClassCreate: true }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (req.user!.userRankLevel < (forum.minClassCreate ?? 0)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to create topics in this forum' });
    }

    const { title, body, question, answers } = req.body as {
      title: string;
      body: string;
      question?: string;
      answers?: string;
    };

    const topic = await prisma.$transaction(async (tx) => {
      const topic = await tx.forumTopic.create({
        data: { title, forumId, authorId: req.user!.id }
      });

      const post = await tx.forumPost.create({
        data: {
          forumTopicId: topic.id,
          authorId: req.user!.id,
          body: sanitizeHtml(body)
        }
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

      if (question && answers) {
        await tx.forumPoll.create({
          data: {
            forumTopicId: topic.id,
            question: sanitizePlain(question),
            answers: sanitizePlain(answers)
          }
        });
      }

      return topic;
    });

    res.status(201).json(topic);
  })
);

// PUT /api/forums/:forumId/topics/:forumTopicId — author or moderator
router.put(
  '/:forumTopicId',
  requireAuth,
  validate(updateTopicSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const forumId = parseInt(req.params.forumId);
    const id = parseInt(req.params.forumTopicId);
    if (isNaN(forumId) || isNaN(id))
      return res.status(400).json({ msg: 'Invalid topic id' });
    const topic = await prisma.forumTopic.findFirst({
      where: { id, forumId, deletedAt: null }
    });
    if (!topic) return res.status(404).json({ msg: 'Topic not found' });

    const isOwner = topic.authorId === req.user!.id;
    if (!isOwner && !(await isModerator(req, res))) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    const { title, isLocked, isSticky } = req.body;
    const updated = await prisma.forumTopic.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(isLocked !== undefined && { isLocked }),
        ...(isSticky !== undefined && { isSticky })
      }
    });
    res.json(updated);
  })
);

// DELETE /api/forums/:forumId/topics/:forumTopicId — author or moderator
router.delete(
  '/:forumTopicId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const forumId = parseInt(req.params.forumId);
    const id = parseInt(req.params.forumTopicId);
    if (isNaN(forumId) || isNaN(id))
      return res.status(400).json({ msg: 'Invalid topic id' });
    const topic = await prisma.forumTopic.findFirst({
      where: { id, forumId, deletedAt: null }
    });
    if (!topic) return res.status(404).json({ msg: 'Topic not found' });

    const isOwner = topic.authorId === req.user!.id;
    if (!isOwner && !(await isModerator(req, res))) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    const isModAction = !isOwner;

    const livePostCount = await prisma.forumPost.count({
      where: { forumTopicId: id, deletedAt: null }
    });

    await prisma.$transaction([
      prisma.forumTopic.update({
        where: { id },
        data: { deletedAt: new Date() }
      }),
      prisma.forum.update({
        where: { id: topic.forumId },
        data: {
          numTopics: { decrement: 1 },
          numPosts: { decrement: livePostCount }
        }
      }),
      prisma.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: isModAction ? 'topic.mod_delete' : 'topic.delete',
          targetType: 'ForumTopic',
          targetId: id
        }
      })
    ]);

    res.json({ msg: 'Topic removed' });
  })
);

export default router;
