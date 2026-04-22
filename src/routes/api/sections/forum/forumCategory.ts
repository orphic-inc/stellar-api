import express, { Request, Response } from 'express';
import { check, validationResult } from 'express-validator';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';

const router = express.Router();

// GET /api/forums/categories
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
  requireAuth,
  [check('name', 'Name is required').not().isEmpty()],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { name, sort } = req.body as { name: string; sort?: number };
    const category = await prisma.forumCategory.create({
      data: { name, sort: sort ?? 0 }
    });
    res.json(category);
  })
);

// PUT /api/forums/categories/:id
router.put(
  '/:id',
  requireAuth,
  [check('name', 'Name is required').not().isEmpty()],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const existing = await prisma.forumCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Category not found' });
    const { name, sort } = req.body as { name: string; sort?: number };
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
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const existing = await prisma.forumCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Category not found' });
    await prisma.forumCategory.delete({ where: { id } });
    res.json({ msg: 'Category removed' });
  })
);

export default router;
