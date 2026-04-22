import express, { Request, Response } from 'express';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';
import { requirePermission } from '../../../../middleware/permissions';

const router = express.Router();

// GET /api/forums/categories — PUBLIC read
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const categories = await prisma.forumCategory.findMany({
      orderBy: { sort: 'asc' },
      include: { forums: { orderBy: { sort: 'asc' } } }
    });
    res.json(categories);
  })
);

// GET /api/forums/categories/:id
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const category = await prisma.forumCategory.findUnique({
      where: { id },
      include: { forums: true }
    });
    if (!category) return res.status(404).json({ msg: 'Category not found' });
    res.json(category);
  })
);

// POST /api/forums/categories
router.post(
  '/',
  ...requirePermission('forums_manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, sort } = req.body as { name: string; sort?: number };
    if (!name) return res.status(400).json({ msg: 'Name is required' });
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
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const existing = await prisma.forumCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Category not found' });
    const { name, sort } = req.body as { name: string; sort?: number };
    if (!name) return res.status(400).json({ msg: 'Name is required' });
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
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const existing = await prisma.forumCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Category not found' });
    await prisma.forumCategory.delete({ where: { id } });
    res.status(204).send();
  })
);

export default router;
