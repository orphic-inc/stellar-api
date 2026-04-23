import express, { Request, Response } from 'express';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';
import { requirePermission } from '../../../../middleware/permissions';
import { validate } from '../../../../middleware/validate';
import { createForumSchema } from '../../../../schemas/forum';
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
        lastTopic: { select: { id: true, title: true } }
      }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    res.json(forum);
  })
);

// POST /api/forums — requires forums_manage permission
router.post(
  '/',
  ...requirePermission('forums_manage'),
  validate(createForumSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const {
      forumCategoryId, sort, name, description,
      minClassRead, minClassWrite, minClassCreate, autoLock, autoLockWeeks
    } = req.body;

    const forum = await prisma.forum.create({
      data: {
        forumCategoryId,
        sort,
        name,
        description: description ?? '',
        minClassRead,
        minClassWrite,
        minClassCreate,
        autoLock,
        autoLockWeeks
      }
    });
    res.status(201).json(forum);
  })
);

// PUT /api/forums/:id — requires forums_manage permission
router.put(
  '/:id',
  ...requirePermission('forums_manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const existing = await prisma.forum.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Forum not found' });

    const { name, description, sort, minClassRead, minClassWrite, minClassCreate, autoLock, autoLockWeeks } = req.body;
    const forum = await prisma.forum.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(sort !== undefined && { sort }),
        ...(minClassRead !== undefined && { minClassRead }),
        ...(minClassWrite !== undefined && { minClassWrite }),
        ...(minClassCreate !== undefined && { minClassCreate }),
        ...(autoLock !== undefined && { autoLock }),
        ...(autoLockWeeks !== undefined && { autoLockWeeks })
      }
    });
    res.json(forum);
  })
);

// DELETE /api/forums/:id — requires forums_manage permission
router.delete(
  '/:id',
  ...requirePermission('forums_manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const existing = await prisma.forum.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Forum not found' });
    if (existing.isTrash) return res.status(400).json({ msg: 'Cannot delete the Trash forum' });

    const trash = await prisma.forum.findFirst({ where: { isTrash: true } });
    if (!trash) return res.status(500).json({ msg: 'Trash forum not found — check install seed' });

    await prisma.$transaction([
      prisma.forumTopic.updateMany({ where: { forumId: id }, data: { forumId: trash.id } }),
      prisma.forum.delete({ where: { id } })
    ]);
    res.status(204).send();
  })
);

export default router;
