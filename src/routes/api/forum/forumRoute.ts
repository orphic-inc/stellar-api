import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { deleteForum } from '../../../modules/forum';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import {
  parsedBody,
  validate,
  validateParams,
  parsedParams
} from '../../../middleware/validate';
import {
  createForumSchema,
  updateForumSchema,
  type CreateForumInput,
  type UpdateForumInput
} from '../../../schemas/forum';
import forumTopicRouter from './forumTopic';

const router = express.Router();
const forumIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

router.use('/:forumId/topics', forumTopicRouter);

// GET /api/forums
router.get(
  '/',
  requireAuth,
  authHandler(async (req, res) => {
    const forums = await prisma.forum.findMany({
      where: { minClassRead: { lte: req.user.userRankLevel } },
      orderBy: { sort: 'asc' },
      include: {
        forumCategory: { select: { id: true, name: true } },
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
  validateParams(forumIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const forum = await prisma.forum.findUnique({
      where: { id },
      include: {
        forumCategory: true,
        lastTopic: { select: { id: true, title: true } }
      }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (req.user.userRankLevel < (forum.minClassRead ?? 0)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to read this forum' });
    }
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
      forumCategoryId,
      sort,
      name,
      description,
      minClassRead,
      minClassWrite,
      minClassCreate,
      autoLock,
      autoLockWeeks
    } = parsedBody<CreateForumInput>(res);

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
  validateParams(forumIdParamsSchema),
  validate(updateForumSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const existing = await prisma.forum.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Forum not found' });

    const {
      name,
      description,
      sort,
      minClassRead,
      minClassWrite,
      minClassCreate,
      autoLock,
      autoLockWeeks
    } = parsedBody<UpdateForumInput>(res);
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
  validateParams(forumIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await deleteForum(id);
    if (!result.ok) {
      if (result.reason === 'not_found')
        return res.status(404).json({ msg: 'Forum not found' });
      if (result.reason === 'is_trash')
        return res.status(400).json({ msg: 'Cannot delete the Trash forum' });
      return res
        .status(500)
        .json({ msg: 'Trash forum not found — check install seed' });
    }
    res.status(204).send();
  })
);

export default router;
