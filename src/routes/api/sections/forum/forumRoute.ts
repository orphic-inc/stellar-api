import express, { Request, Response } from 'express';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';
import forumTopicRouter from './forumTopic';

const router = express.Router();

router.use('/:forumId/topics', forumTopicRouter);

// GET /api/forums
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const forums = await prisma.forum.findMany({
      orderBy: { sort: 'asc' },
      include: {
        forumCategory: true,
        lastTopic: {
          include: { author: { select: { id: true, username: true } } }
        }
      }
    });
    res.json(forums);
  })
);

// GET /api/forums/:id
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const forum = await prisma.forum.findUnique({
      where: { id },
      include: {
        forumCategory: true,
        topics: {
          orderBy: [{ isSticky: 'desc' }, { updatedAt: 'desc' }],
          include: {
            author: { select: { id: true, username: true } },
            lastPost: { include: { author: { select: { id: true, username: true } } } }
          }
        }
      }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    res.json(forum);
  })
);

// POST /api/forums
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const {
      forumCategoryId, sort, name, description,
      minClassRead, minClassWrite, minClassCreate,
      autoLock, autoLockWeeks
    } = req.body as {
      forumCategoryId: number; sort: number; name: string; description?: string;
      minClassRead?: number; minClassWrite?: number; minClassCreate?: number;
      autoLock?: boolean; autoLockWeeks?: number;
    };

    const forum = await prisma.forum.create({
      data: {
        forumCategoryId, sort, name,
        description: description ?? '',
        minClassRead: minClassRead ?? 0,
        minClassWrite: minClassWrite ?? 0,
        minClassCreate: minClassCreate ?? 0,
        autoLock: autoLock ?? true,
        autoLockWeeks: autoLockWeeks ?? 4
      }
    });
    res.json(forum);
  })
);

export default router;
