import express, { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma';
import { authHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { lastReadSchema, type LastReadInput } from '../../../schemas/forum';

const router = express.Router();

// GET /api/forums/last-read — get all last-read markers for current user
router.get(
  '/',
  requireAuth,
  authHandler(async (req, res) => {
    const records = await prisma.forumLastReadTopic.findMany({
      where: { userId: req.user.id }
    });
    res.json(records);
  })
);

// POST /api/forums/last-read — upsert a last-read marker
router.post(
  '/',
  requireAuth,
  validate(lastReadSchema),
  authHandler(async (req, res) => {
    const { forumTopicId, forumPostId } = req.body as LastReadInput;
    const userId = req.user.id;

    const post = await prisma.forumPost.findFirst({
      where: {
        id: forumPostId,
        forumTopicId,
        deletedAt: null,
        forumTopic: { deletedAt: null }
      },
      include: {
        forumTopic: {
          select: {
            forum: { select: { minClassRead: true } }
          }
        }
      }
    });
    if (!post) {
      return res.status(404).json({ msg: 'Forum post not found' });
    }
    if (req.user.userRankLevel < (post.forumTopic?.forum.minClassRead ?? 0)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to read this forum' });
    }

    const record = await prisma.forumLastReadTopic.upsert({
      where: { userId_forumTopicId: { userId, forumTopicId } },
      create: { userId, forumTopicId, forumPostId },
      update: { forumPostId }
    });
    res.json(record);
  })
);

export default router;
