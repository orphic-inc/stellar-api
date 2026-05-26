import express, { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import {
  requirePermission,
  requireAdminOnly
} from '../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import { audit } from '../../lib/audit';
import {
  createRankSchema,
  updateRankSchema,
  type CreateRankInput,
  type UpdateRankInput
} from '../../schemas/tools';
import {
  createStaffGroupSchema,
  updateStaffGroupSchema,
  type CreateStaffGroupInput,
  type UpdateStaffGroupInput
} from '../../schemas/staff';

const router = express.Router();

const userRankIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});
const staffGroupIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

const formatRank = (
  r: Prisma.UserRankGetPayload<{
    include: { _count: { select: { users: true } } };
  }>
) => ({
  id: r.id,
  name: r.name,
  level: r.level,
  permissions: r.permissions,
  color: r.color,
  badge: r.badge,
  personalCollageLimit: r.personalCollageLimit,
  displayStaff: r.displayStaff,
  staffGroupId: r.staffGroupId,
  userCount: r._count.users
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
    res.json(ranks.map(formatRank));
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

    res.json(formatRank(rank));
  })
);

// POST /api/tools/user-ranks — create rank
router.post(
  '/user-ranks',
  ...requirePermission('admin'),
  validate(createRankSchema),
  authHandler(async (req, res) => {
    const {
      name,
      level,
      permissions,
      color,
      badge,
      personalCollageLimit,
      displayStaff,
      staffGroupId
    } = parsedBody<CreateRankInput>(res);

    if (staffGroupId != null) {
      const group = await prisma.staffGroup.findUnique({
        where: { id: staffGroupId }
      });
      if (!group) return res.status(422).json({ msg: 'Staff group not found' });
    }

    const groupId = staffGroupId ?? null;
    const effectiveStaffGroupId = displayStaff ? groupId : null;

    try {
      const rank = await prisma.userRank.create({
        data: {
          name,
          level,
          permissions: permissions ?? {},
          color: color ?? '',
          badge: badge ?? '',
          personalCollageLimit: personalCollageLimit ?? 0,
          displayStaff: displayStaff ?? false,
          staffGroupId: effectiveStaffGroupId
        },
        include: { _count: { select: { users: true } } }
      });

      await audit(prisma, req.user.id, 'rank.create', 'UserRank', rank.id, {
        name,
        level,
        displayStaff,
        staffGroupId: effectiveStaffGroupId
      });
      res.status(201).json(formatRank(rank));
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return res
          .status(409)
          .json({ msg: 'A rank with that name or level already exists' });
      }
      throw err;
    }
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

    const existing = await prisma.userRank.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Rank not found' });

    const {
      name,
      level,
      permissions,
      color,
      badge,
      personalCollageLimit,
      displayStaff,
      staffGroupId
    } = parsedBody<UpdateRankInput>(res);

    if (staffGroupId != null) {
      const group = await prisma.staffGroup.findUnique({
        where: { id: staffGroupId }
      });
      if (!group) return res.status(422).json({ msg: 'Staff group not found' });
    }

    // Clear group assignment when staff display is turned off
    const effectiveStaffGroupId = displayStaff === false ? null : staffGroupId;

    try {
      const rank = await prisma.userRank.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(level !== undefined && { level }),
          ...(permissions !== undefined && { permissions }),
          ...(color !== undefined && { color }),
          ...(badge !== undefined && { badge }),
          ...(personalCollageLimit !== undefined && { personalCollageLimit }),
          ...(displayStaff !== undefined && { displayStaff }),
          ...(effectiveStaffGroupId !== undefined && {
            staffGroupId: effectiveStaffGroupId
          })
        },
        include: { _count: { select: { users: true } } }
      });

      await audit(prisma, req.user.id, 'rank.update', 'UserRank', id, {
        name,
        level,
        permissions,
        displayStaff,
        staffGroupId: effectiveStaffGroupId
      });
      res.json(formatRank(rank));
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return res
          .status(409)
          .json({ msg: 'A rank with that name or level already exists' });
      }
      throw err;
    }
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

// ─── Staff Groups ──────────────────────────────────────────────────────────────

// GET /api/tools/staff-groups — list all staff groups (admin only)
router.get(
  '/staff-groups',
  ...requireAdminOnly(),
  asyncHandler(async (_req: Request, res: Response) => {
    const groups = await prisma.staffGroup.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { userRanks: true } } }
    });
    res.json(
      groups.map((g) => ({
        id: g.id,
        name: g.name,
        sortOrder: g.sortOrder,
        rankCount: g._count.userRanks
      }))
    );
  })
);

// POST /api/tools/staff-groups — create staff group (admin only)
router.post(
  '/staff-groups',
  ...requireAdminOnly(),
  validate(createStaffGroupSchema),
  authHandler(async (req, res) => {
    const { name, sortOrder } = parsedBody<CreateStaffGroupInput>(res);

    try {
      const group = await prisma.staffGroup.create({
        data: { name, sortOrder }
      });
      await audit(
        prisma,
        req.user.id,
        'staffGroup.create',
        'StaffGroup',
        group.id,
        { name }
      );
      res.status(201).json({
        id: group.id,
        name: group.name,
        sortOrder: group.sortOrder,
        rankCount: 0
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return res
          .status(409)
          .json({ msg: 'A staff group with that name already exists' });
      }
      throw err;
    }
  })
);

// PUT /api/tools/staff-groups/:id — update staff group (admin only)
router.put(
  '/staff-groups/:id',
  ...requireAdminOnly(),
  validateParams(staffGroupIdParamsSchema),
  validate(updateStaffGroupSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { name, sortOrder } = parsedBody<UpdateStaffGroupInput>(res);

    const existing = await prisma.staffGroup.findUnique({ where: { id } });
    if (!existing)
      return res.status(404).json({ msg: 'Staff group not found' });

    try {
      const group = await prisma.staffGroup.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(sortOrder !== undefined && { sortOrder })
        },
        include: { _count: { select: { userRanks: true } } }
      });
      await audit(prisma, req.user.id, 'staffGroup.update', 'StaffGroup', id, {
        name,
        sortOrder
      });
      res.json({
        id: group.id,
        name: group.name,
        sortOrder: group.sortOrder,
        rankCount: group._count.userRanks
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return res
          .status(409)
          .json({ msg: 'A staff group with that name already exists' });
      }
      throw err;
    }
  })
);

// DELETE /api/tools/staff-groups/:id — delete staff group (admin only, blocks if ranks assigned)
router.delete(
  '/staff-groups/:id',
  ...requireAdminOnly(),
  validateParams(staffGroupIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);

    const existing = await prisma.staffGroup.findUnique({
      where: { id },
      select: { id: true }
    });
    if (!existing)
      return res.status(404).json({ msg: 'Staff group not found' });

    const rankCount = await prisma.userRank.count({
      where: { staffGroupId: id }
    });
    if (rankCount > 0) {
      return res.status(409).json({
        msg: `Cannot delete group: ${rankCount} rank(s) still assigned. Reassign them first.`
      });
    }

    await prisma.$transaction([
      prisma.staffGroup.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: 'staffGroup.delete',
          targetType: 'StaffGroup',
          targetId: id
        }
      })
    ]);
    res.status(204).send();
  })
);

export default router;
