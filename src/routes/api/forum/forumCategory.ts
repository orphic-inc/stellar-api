import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import {
  requirePermission,
  loadPermissions
} from '../../../middleware/permissions';
import { canAccessForumLevel } from '../../../lib/userRankAccess';
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

// GET /api/forums/categories — pass ?all=true to skip the empty-category filter (admin)
router.get(
  '/',
  requireAuth,
  authHandler(async (req, res) => {
    const showAll = req.query.all === 'true';
    if (showAll) {
      const perms = await loadPermissions(req, res);
      if (
        !perms['forums_manage'] &&
        !perms['rank_permissions_manage'] &&
        !perms['admin']
      ) {
        return res.status(403).json({ msg: 'Permission denied' });
      }
    }
    const categories = await prisma.forumCategory.findMany({
      orderBy: { sort: 'asc' },
      include: {
        forums: {
          orderBy: { sort: 'asc' },
          include: {
            lastTopic: { select: { id: true, title: true } }
          }
        }
      }
    });
    const visibleCategories = categories
      .map((category) => ({
        ...category,
        forums: showAll
          ? category.forums
          : category.forums.filter((forum) =>
              canAccessForumLevel(req.user, forum.id, forum.minClassRead)
            )
      }))
      .filter((category) => showAll || category.forums.length > 0);
    res.json(visibleCategories);
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
          orderBy: { sort: 'asc' },
          include: {
            lastTopic: { select: { id: true, title: true } }
          }
        }
      }
    });
    if (!category) return res.status(404).json({ msg: 'Category not found' });
    res.json({
      ...category,
      forums: category.forums.filter((forum) =>
        canAccessForumLevel(req.user, forum.id, forum.minClassRead)
      )
    });
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
