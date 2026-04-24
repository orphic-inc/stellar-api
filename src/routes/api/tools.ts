import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedParams
} from '../../middleware/validate';
import { audit } from '../../lib/audit';
import {
  createRankSchema,
  updateRankSchema,
  type CreateRankInput,
  type UpdateRankInput
} from '../../schemas/tools';

const router = express.Router();
const userRankIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/tools/user-ranks — list all user ranks
router.get(
  '/user-ranks',
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

// GET /api/tools/user-ranks/:id — get single rank
router.get(
  '/user-ranks/:id',
  ...requirePermission('admin'),
  validateParams(userRankIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);

    const rank = await prisma.userRank.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } }
    });
    if (!rank) return res.status(404).json({ msg: 'Rank not found' });

    res.json({ ...rank, userCount: rank._count.users });
  })
);

// POST /api/tools/user-ranks — create rank
router.post(
  '/user-ranks',
  ...requirePermission('admin'),
  validate(createRankSchema),
  authHandler(async (req, res) => {
    const { name, level, permissions, color, badge } =
      req.body as CreateRankInput;

    const rank = await prisma.userRank.create({
      data: {
        name,
        level,
        permissions: permissions ?? {},
        color: color ?? '',
        badge: badge ?? ''
      }
    });

    await audit(prisma, req.user.id, 'rank.create', 'UserRank', rank.id, {
      name,
      level
    });
    res.status(201).json(rank);
  })
);

// PUT /api/tools/user-ranks/:id — update rank
router.put(
  '/user-ranks/:id',
  ...requirePermission('admin'),
  validateParams(userRankIdParamsSchema),
  validate(updateRankSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);

    const { name, level, permissions, color, badge } =
      req.body as UpdateRankInput;
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

    await audit(prisma, req.user.id, 'rank.update', 'UserRank', id, {
      name,
      level,
      permissions
    });
    res.json(rank);
  })
);

// DELETE /api/tools/user-ranks/:id — delete rank (blocks if users are assigned)
router.delete(
  '/user-ranks/:id',
  ...requirePermission('admin'),
  validateParams(userRankIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);

    const userCount = await prisma.user.count({ where: { userRankId: id } });
    if (userCount > 0) {
      return res.status(409).json({
        msg: `Cannot delete rank: ${userCount} user(s) currently assigned to it`
      });
    }

    await prisma.$transaction([
      prisma.userRank.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: 'rank.delete',
          targetType: 'UserRank',
          targetId: id
        }
      })
    ]);
    res.status(204).send();
  })
);

export default router;
