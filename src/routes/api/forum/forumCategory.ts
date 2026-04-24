import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import {
  parsedBody,
  validate,
  validateParams,
  parsedParams
} from '../../../middleware/validate';
import {
  createForumCategorySchema,
  updateForumCategorySchema,
  type CreateForumCategoryInput,
  type UpdateForumCategoryInput
} from '../../../schemas/forumCategory';

const router = express.Router();
const forumCategoryIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/forums/categories
router.get(
  '/',
  requireAuth,
  authHandler(async (req, res) => {
    const categories = await prisma.forumCategory.findMany({
      orderBy: { sort: 'asc' },
      include: {
        forums: {
          where: { minClassRead: { lte: req.user.userRankLevel } },
          orderBy: { sort: 'asc' },
          include: {
            lastTopic: { select: { id: true, title: true } }
          }
        }
      }
    });
    res.json(categories.filter((category) => category.forums.length > 0));
  })
);

// GET /api/forums/categories/:id
router.get(
  '/:id',
  requireAuth,
  validateParams(forumCategoryIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const category = await prisma.forumCategory.findUnique({
      where: { id },
      include: {
        forums: {
          where: { minClassRead: { lte: req.user.userRankLevel } },
          orderBy: { sort: 'asc' },
          include: {
            lastTopic: { select: { id: true, title: true } }
          }
        }
      }
    });
    if (!category) return res.status(404).json({ msg: 'Category not found' });
    res.json(category);
  })
);

// POST /api/forums/categories
router.post(
  '/',
  ...requirePermission('forums_manage'),
  validate(createForumCategorySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, sort } = parsedBody<CreateForumCategoryInput>(res);
    const category = await prisma.forumCategory.create({
      data: { name, sort: sort ?? 0 }
    });
    res.status(201).json(category);
  })
);

// PUT /api/forums/categories/:id
router.put(
  '/:id',
  ...requirePermission('forums_manage'),
  validateParams(forumCategoryIdParamsSchema),
  validate(updateForumCategorySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const existing = await prisma.forumCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Category not found' });
    const { name, sort } = parsedBody<UpdateForumCategoryInput>(res);
    const category = await prisma.forumCategory.update({
      where: { id },
      data: { name, ...(sort !== undefined && { sort }) }
    });
    res.json(category);
  })
);

// DELETE /api/forums/categories/:id
router.delete(
  '/:id',
  ...requirePermission('forums_manage'),
  validateParams(forumCategoryIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const existing = await prisma.forumCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Category not found' });
    await prisma.forumCategory.delete({ where: { id } });
    res.status(204).send();
  })
);

export default router;
