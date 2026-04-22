import express, { Request, Response } from 'express';
import { check, validationResult } from 'express-validator';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';
import forumPostRouter from './forumPost';

const router = express.Router({ mergeParams: true });

router.use('/:forumTopicId/posts', forumPostRouter);

// GET /api/forums/:forumId/topics
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const forumId = parseInt(req.params.forumId);
    if (isNaN(forumId)) return res.status(400).json({ msg: 'Invalid forum id' });
    const topics = await prisma.forumTopic.findMany({
      where: { forumId },
      orderBy: [{ isSticky: 'desc' }, { updatedAt: 'desc' }],
      include: {
        author: { select: { id: true, username: true } },
        lastPost: { include: { author: { select: { id: true, username: true } } } }
      }
    });
    res.json(topics);
  })
);

// GET /api/forums/:forumId/topics/:forumTopicId
router.get(
  '/:forumTopicId',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.forumTopicId);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid topic id' });
    const topic = await prisma.forumTopic.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, username: true, avatar: true } },
        poll: { include: { votes: true } },
        notes: { include: { author: { select: { id: true, username: true } } } }
      }
    });
    if (!topic) return res.status(404).json({ msg: 'Topic not found' });
    res.json(topic);
  })
);

// POST /api/forums/:forumId/topics
router.post(
  '/',
  requireAuth,
  [
    check('title', 'Title is required').not().isEmpty(),
    check('body', 'Body is required').not().isEmpty()
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const forumId = parseInt(req.params.forumId);
    const forum = await prisma.forum.findUnique({ where: { id: forumId } });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });

    const { title, body, question, answers } = req.body as {
      title: string; body: string; question?: string; answers?: string;
    };

    const topic = await prisma.$transaction(async (tx) => {
      const topic = await tx.forumTopic.create({
        data: { title, forumId, authorId: req.user!.id }
      });

      const post = await tx.forumPost.create({
        data: { forumTopicId: topic.id, authorId: req.user!.id, body }
      });

      await tx.forumTopic.update({
        where: { id: topic.id },
        data: { lastPostId: post.id, numPosts: 1 }
      });

      await tx.forum.update({
        where: { id: forumId },
        data: { lastTopicId: topic.id, numTopics: { increment: 1 }, numPosts: { increment: 1 } }
      });

      if (question && answers) {
        await tx.forumPoll.create({
          data: { forumTopicId: topic.id, question, answers }
        });
      }

      return topic;
    });

    res.json(topic);
  })
);

// PUT /api/forums/:forumId/topics/:forumTopicId — update title / lock / sticky
router.put(
  '/:forumTopicId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.forumTopicId);
    const topic = await prisma.forumTopic.findUnique({ where: { id } });
    if (!topic) return res.status(404).json({ msg: 'Topic not found' });
    if (topic.authorId !== req.user!.id) return res.status(403).json({ msg: 'Not authorized' });

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

// DELETE /api/forums/:forumId/topics/:forumTopicId
router.delete(
  '/:forumTopicId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.forumTopicId);
    const topic = await prisma.forumTopic.findUnique({ where: { id } });
    if (!topic) return res.status(404).json({ msg: 'Topic not found' });
    if (topic.authorId !== req.user!.id) return res.status(403).json({ msg: 'Not authorized' });
    await prisma.forumTopic.delete({ where: { id } });
    res.json({ msg: 'Topic removed' });
  })
);

export default router;
