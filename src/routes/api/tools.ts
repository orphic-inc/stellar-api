import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requirePermission } from '../../middleware/permissions';

const router = express.Router();

// GET /api/tools/permissions — list all user ranks
router.get(
  '/permissions',
  ...requirePermission('admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const ranks = await prisma.userRank.findMany({
      orderBy: { level: 'asc' },
      include: { _count: { select: { users: true } } }
    });
    res.json(
      ranks.map((r) => ({
        id: r.id,
        name: r.name,
        level: r.level,
        permissions: r.permissions,
        color: r.color,
        badge: r.badge,
        userCount: r._count.users
      }))
    );
  })
);

// GET /api/tools/permissions/:id — get single rank
router.get(
  '/permissions/:id',
  ...requirePermission('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });

    const rank = await prisma.userRank.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } }
    });
    if (!rank) return res.status(404).json({ msg: 'Rank not found' });

    res.json({ ...rank, userCount: rank._count.users });
  })
);

// POST /api/tools/permissions — create rank
router.post(
  '/permissions',
  ...requirePermission('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, level, permissions, color, badge } = req.body as {
      name: string;
      level: number;
      permissions?: Record<string, boolean>;
      color?: string;
      badge?: string;
    };

    if (!name || level === undefined) {
      return res.status(400).json({ msg: 'name and level are required' });
    }

    const rank = await prisma.userRank.create({
      data: {
        name,
        level,
        permissions: permissions ?? {},
        color: color ?? '',
        badge: badge ?? ''
      }
    });
    res.status(201).json(rank);
  })
);

// PUT /api/tools/permissions/:id — update rank
router.put(
  '/permissions/:id',
  ...requirePermission('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });

    const { name, level, permissions, color, badge } = req.body;
    const rank = await prisma.userRank.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(level !== undefined && { level }),
        ...(permissions !== undefined && { permissions }),
        ...(color !== undefined && { color }),
        ...(badge !== undefined && { badge })
      }
    });
    res.json(rank);
  })
);

// DELETE /api/tools/permissions/:id — delete rank (blocks if users are assigned)
router.delete(
  '/permissions/:id',
  ...requirePermission('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });

    const userCount = await prisma.user.count({ where: { userRankId: id } });
    if (userCount > 0) {
      return res.status(409).json({
        msg: `Cannot delete rank: ${userCount} user(s) currently assigned to it`
      });
    }

    await prisma.userRank.delete({ where: { id } });
    res.status(204).send();
  })
);

export default router;
