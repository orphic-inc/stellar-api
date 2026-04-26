import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import {
  loadPermissions,
  requirePermission
} from '../../middleware/permissions';
import {
  parsedBody,
  validate,
  validateParams,
  validateQuery,
  parsedParams,
  parsedQuery
} from '../../middleware/validate';
import { sanitizeHtml } from '../../lib/sanitize';
import { parsePage, paginatedResponse } from '../../lib/pagination';
import {
  createCollageSchema,
  updateCollageSchema,
  collageQuerySchema,
  addEntrySchema,
  reorderEntriesSchema,
  type CreateCollageInput,
  type UpdateCollageInput,
  type CollageQueryInput,
  type AddEntryInput,
  type ReorderEntriesInput
} from '../../schemas/collage';
import type { AuthenticatedRequest } from '../../types/auth';

const router = express.Router();

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const entryParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  releaseId: z.coerce.number().int().positive()
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isStaffOrModerator = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<boolean> => {
  const perms = await loadPermissions(req, res);
  return !!(perms['collages_moderate'] || perms['staff'] || perms['admin']);
};

const collageInclude = {
  user: { select: { id: true, username: true, avatar: true } },
  _count: { select: { entries: true, subscriptions: true, bookmarks: true } }
};

// Personal collages: categoryId === 0
const isPersonal = (categoryId: number) => categoryId === 0;

// ─── GET /api/collages ────────────────────────────────────────────────────────

router.get(
  '/',
  requireAuth,
  validateQuery(collageQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const { search, categoryId, userId, bookmarked, orderBy, order } =
      parsedQuery<CollageQueryInput>(res);
    const pg = parsePage(req);

    const sortField = orderBy ?? 'createdAt';
    const sortDir = order ?? 'desc';

    const where: Record<string, unknown> = { isDeleted: false };

    // Exclude personal collages from general browse unless filtered by owner
    if (categoryId !== undefined) {
      where.categoryId = categoryId;
    } else if (!userId) {
      where.categoryId = { gt: 0 };
    }

    if (userId) where.userId = userId;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (bookmarked === 'true') {
      where.bookmarks = { some: { userId: authReq.user.id } };
    }

    const [collages, total] = await Promise.all([
      prisma.collage.findMany({
        where,
        skip: pg.skip,
        take: pg.limit,
        orderBy: { [sortField]: sortDir },
        include: collageInclude
      }),
      prisma.collage.count({ where })
    ]);

    paginatedResponse(res, collages, total, pg);
  })
);

// ─── GET /api/collages/:id ────────────────────────────────────────────────────

router.get(
  '/:id',
  requireAuth,
  validateParams(idParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const authReq = req as AuthenticatedRequest;

    const collage = await prisma.collage.findUnique({
      where: { id },
      include: {
        ...collageInclude,
        entries: {
          orderBy: { sort: 'asc' },
          include: {
            release: {
              select: {
                id: true,
                title: true,
                image: true,
                year: true,
                releaseType: true,
                artist: { select: { id: true, name: true } }
              }
            },
            user: { select: { id: true, username: true } }
          }
        }
      }
    });

    if (!collage) return res.status(404).json({ msg: 'Collage not found' });

    if (collage.isDeleted && !(await isStaffOrModerator(authReq, res))) {
      return res.status(404).json({ msg: 'Collage not found' });
    }

    // For personal collages, only owner or staff can view
    if (isPersonal(collage.categoryId)) {
      if (
        collage.userId !== authReq.user.id &&
        !(await isStaffOrModerator(authReq, res))
      ) {
        return res.status(403).json({ msg: 'Permission denied' });
      }
    }

    // Subscription context for the requesting user
    const subscription = await prisma.collageSubscription.findUnique({
      where: { userId_collageId: { userId: authReq.user.id, collageId: id } }
    });
    const bookmark = await prisma.bookmarkCollage.findUnique({
      where: { userId_collageId: { userId: authReq.user.id, collageId: id } }
    });

    // Update lastVisit if subscribed
    if (subscription) {
      await prisma.collageSubscription.update({
        where: { userId_collageId: { userId: authReq.user.id, collageId: id } },
        data: { lastVisit: new Date() }
      });
    }

    res.json({
      ...collage,
      isSubscribed: !!subscription,
      isBookmarked: !!bookmark
    });
  })
);

// ─── POST /api/collages ───────────────────────────────────────────────────────

router.post(
  '/',
  requireAuth,
  validate(createCollageSchema),
  authHandler(async (req, res) => {
    const { name, description, categoryId, tags } =
      parsedBody<CreateCollageInput>(res);
    const userId = req.user.id;

    // Personal collage: reset featured if this is the new featured one
    // (handled at update time; creation doesn't set featured)

    const existingName = await prisma.collage.findFirst({
      where: { name, isDeleted: false }
    });
    if (existingName) {
      return res
        .status(409)
        .json({ msg: 'A collage with this name already exists' });
    }

    const collage = await prisma.collage.create({
      data: {
        name,
        description: sanitizeHtml(description),
        userId,
        categoryId,
        tags
      },
      include: collageInclude
    });

    res.status(201).json(collage);
  })
);

// ─── PUT /api/collages/:id ────────────────────────────────────────────────────

router.put(
  '/:id',
  requireAuth,
  validateParams(idParamsSchema),
  validate(updateCollageSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const updates = parsedBody<UpdateCollageInput>(res);
    const userId = req.user.id;
    const staff = await isStaffOrModerator(req, res);

    const collage = await prisma.collage.findUnique({ where: { id } });
    if (!collage || collage.isDeleted)
      return res.status(404).json({ msg: 'Collage not found' });

    const isOwner = collage.userId === userId;
    if (!isOwner && !staff)
      return res.status(403).json({ msg: 'Permission denied' });

    const data: Record<string, unknown> = {};

    // Name: owner of personal collage or staff only
    if (updates.name !== undefined) {
      if (!staff && !isPersonal(collage.categoryId)) {
        return res
          .status(403)
          .json({ msg: 'Only staff can rename public collages' });
      }
      const conflict = await prisma.collage.findFirst({
        where: { name: updates.name, isDeleted: false, id: { not: id } }
      });
      if (conflict)
        return res.status(409).json({ msg: 'Collage name already taken' });
      data.name = updates.name;
    }

    if (updates.description !== undefined)
      data.description = sanitizeHtml(updates.description);
    if (updates.tags !== undefined) data.tags = updates.tags;

    // isFeatured: only for personal collages, mutually exclusive
    if (updates.isFeatured !== undefined) {
      if (!isPersonal(collage.categoryId))
        return res
          .status(400)
          .json({ msg: 'Featured only applies to personal collages' });
      if (updates.isFeatured) {
        // Unset featured on all other personal collages by this user
        await prisma.collage.updateMany({
          where: { userId, categoryId: 0, isFeatured: true, id: { not: id } },
          data: { isFeatured: false }
        });
      }
      data.isFeatured = updates.isFeatured;
    }

    // Staff-only fields
    if (updates.isLocked !== undefined) {
      if (!staff)
        return res.status(403).json({ msg: 'Only staff can lock collages' });
      data.isLocked = updates.isLocked;
    }
    if (updates.maxEntries !== undefined) {
      if (!staff)
        return res.status(403).json({ msg: 'Only staff can set entry limits' });
      data.maxEntries = updates.maxEntries;
    }
    if (updates.maxEntriesPerUser !== undefined) {
      if (!staff)
        return res
          .status(403)
          .json({ msg: 'Only staff can set per-user limits' });
      data.maxEntriesPerUser = updates.maxEntriesPerUser;
    }

    const updated = await prisma.collage.update({
      where: { id },
      data,
      include: collageInclude
    });

    res.json(updated);
  })
);

// ─── DELETE /api/collages/:id ─────────────────────────────────────────────────

router.delete(
  '/:id',
  requireAuth,
  validateParams(idParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const userId = req.user.id;
    const staff = await isStaffOrModerator(req, res);

    const collage = await prisma.collage.findUnique({ where: { id } });
    if (!collage || collage.isDeleted)
      return res.status(404).json({ msg: 'Collage not found' });

    const isOwner = collage.userId === userId;
    if (!isOwner && !staff)
      return res.status(403).json({ msg: 'Permission denied' });

    if (isPersonal(collage.categoryId) && (isOwner || staff)) {
      // Hard delete personal collages
      await prisma.collage.delete({ where: { id } });
    } else {
      // Soft delete public collages (staff only)
      if (!staff)
        return res
          .status(403)
          .json({ msg: 'Only staff can delete public collages' });
      await prisma.collage.update({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date() }
      });
    }

    res.status(204).send();
  })
);

// ─── POST /api/collages/:id/recover ───────────────────────────────────────────

router.post(
  '/:id/recover',
  ...requirePermission('collages_moderate'),
  validateParams(idParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);

    const collage = await prisma.collage.findUnique({ where: { id } });
    if (!collage) return res.status(404).json({ msg: 'Collage not found' });
    if (!collage.isDeleted)
      return res.status(400).json({ msg: 'Collage is not deleted' });
    if (isPersonal(collage.categoryId))
      return res
        .status(400)
        .json({ msg: 'Personal collages cannot be recovered' });

    const updated = await prisma.collage.update({
      where: { id },
      data: { isDeleted: false, deletedAt: null },
      include: collageInclude
    });

    res.json(updated);
  })
);

// ─── POST /api/collages/:id/entries ──────────────────────────────────────────

router.post(
  '/:id/entries',
  requireAuth,
  validateParams(idParamsSchema),
  validate(addEntrySchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { releaseId } = parsedBody<AddEntryInput>(res);
    const userId = req.user.id;
    const staff = await isStaffOrModerator(req, res);

    const collage = await prisma.collage.findUnique({ where: { id } });
    if (!collage || collage.isDeleted)
      return res.status(404).json({ msg: 'Collage not found' });

    // Locked check
    if (collage.isLocked && !staff)
      return res.status(403).json({ msg: 'Collage is locked' });

    // Personal collage: only owner (or staff) can add
    if (isPersonal(collage.categoryId) && collage.userId !== userId && !staff)
      return res
        .status(403)
        .json({ msg: 'Only the owner can add to a personal collage' });

    // Release existence check
    const release = await prisma.release.findUnique({
      where: { id: releaseId }
    });
    if (!release) return res.status(404).json({ msg: 'Release not found' });

    // Duplicate check
    const existing = await prisma.collageEntry.findUnique({
      where: { collageId_releaseId: { collageId: id, releaseId } }
    });
    if (existing)
      return res.status(409).json({ msg: 'Release already in collage' });

    // MaxEntries check (staff bypass)
    if (
      !staff &&
      collage.maxEntries > 0 &&
      collage.numEntries >= collage.maxEntries
    ) {
      return res
        .status(400)
        .json({ msg: 'Collage has reached its maximum entry count' });
    }

    // MaxEntriesPerUser check (staff bypass)
    if (!staff && collage.maxEntriesPerUser > 0) {
      const userCount = await prisma.collageEntry.count({
        where: { collageId: id, userId }
      });
      if (userCount >= collage.maxEntriesPerUser) {
        return res
          .status(400)
          .json({ msg: 'You have reached your per-user entry limit' });
      }
    }

    // Get max sort value for new entry
    const maxSort = await prisma.collageEntry.aggregate({
      where: { collageId: id },
      _max: { sort: true }
    });
    const nextSort = (maxSort._max.sort ?? 0) + 10;

    const [entry] = await prisma.$transaction([
      prisma.collageEntry.create({
        data: { collageId: id, releaseId, userId, sort: nextSort },
        include: {
          release: {
            select: {
              id: true,
              title: true,
              image: true,
              year: true,
              releaseType: true,
              artist: { select: { id: true, name: true } }
            }
          },
          user: { select: { id: true, username: true } }
        }
      }),
      prisma.collage.update({
        where: { id },
        data: { numEntries: { increment: 1 } }
      })
    ]);

    res.status(201).json(entry);
  })
);

// ─── DELETE /api/collages/:id/entries/:releaseId ──────────────────────────────

router.delete(
  '/:id/entries/:releaseId',
  requireAuth,
  validateParams(entryParamsSchema),
  authHandler(async (req, res) => {
    const { id, releaseId } = parsedParams<{ id: number; releaseId: number }>(
      res
    );
    const userId = req.user.id;
    const staff = await isStaffOrModerator(req, res);

    const collage = await prisma.collage.findUnique({ where: { id } });
    if (!collage || collage.isDeleted)
      return res.status(404).json({ msg: 'Collage not found' });

    if (collage.isLocked && !staff)
      return res.status(403).json({ msg: 'Collage is locked' });

    const entry = await prisma.collageEntry.findUnique({
      where: { collageId_releaseId: { collageId: id, releaseId } }
    });
    if (!entry) return res.status(404).json({ msg: 'Entry not found' });

    const isOwner = collage.userId === userId;
    const isAdder = entry.userId === userId;
    if (!isOwner && !isAdder && !staff)
      return res.status(403).json({ msg: 'Permission denied' });

    await prisma.$transaction([
      prisma.collageEntry.delete({
        where: { collageId_releaseId: { collageId: id, releaseId } }
      }),
      prisma.collage.update({
        where: { id },
        data: { numEntries: { decrement: 1 } }
      })
    ]);

    res.status(204).send();
  })
);

// ─── PUT /api/collages/:id/entries ────────────────────────────────────────────

router.put(
  '/:id/entries',
  requireAuth,
  validateParams(idParamsSchema),
  validate(reorderEntriesSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { entries } = parsedBody<ReorderEntriesInput>(res);
    const userId = req.user.id;
    const staff = await isStaffOrModerator(req, res);

    const collage = await prisma.collage.findUnique({ where: { id } });
    if (!collage || collage.isDeleted)
      return res.status(404).json({ msg: 'Collage not found' });

    const isOwner = collage.userId === userId;
    if (!isOwner && !staff)
      return res
        .status(403)
        .json({ msg: 'Only the collage owner or staff can reorder entries' });

    await prisma.$transaction(
      entries.map(({ id: entryId, sort }) =>
        prisma.collageEntry.update({
          where: { id: entryId },
          data: { sort }
        })
      )
    );

    res.status(204).send();
  })
);

// ─── POST /api/collages/:id/subscribe ────────────────────────────────────────

router.post(
  '/:id/subscribe',
  requireAuth,
  validateParams(idParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const userId = req.user.id;

    const collage = await prisma.collage.findUnique({ where: { id } });
    if (!collage || collage.isDeleted)
      return res.status(404).json({ msg: 'Collage not found' });

    const existing = await prisma.collageSubscription.findUnique({
      where: { userId_collageId: { userId, collageId: id } }
    });

    if (existing) {
      // Unsubscribe
      await prisma.$transaction([
        prisma.collageSubscription.delete({
          where: { userId_collageId: { userId, collageId: id } }
        }),
        prisma.collage.update({
          where: { id },
          data: { numSubscribers: { decrement: 1 } }
        })
      ]);
      return res.json({ subscribed: false });
    }

    // Subscribe
    await prisma.$transaction([
      prisma.collageSubscription.create({
        data: { userId, collageId: id }
      }),
      prisma.collage.update({
        where: { id },
        data: { numSubscribers: { increment: 1 } }
      })
    ]);

    res.json({ subscribed: true });
  })
);

// ─── POST /api/collages/:id/bookmark ─────────────────────────────────────────

router.post(
  '/:id/bookmark',
  requireAuth,
  validateParams(idParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const userId = req.user.id;

    const collage = await prisma.collage.findUnique({ where: { id } });
    if (!collage || collage.isDeleted)
      return res.status(404).json({ msg: 'Collage not found' });

    const existing = await prisma.bookmarkCollage.findUnique({
      where: { userId_collageId: { userId, collageId: id } }
    });

    if (existing) {
      await prisma.bookmarkCollage.delete({
        where: { userId_collageId: { userId, collageId: id } }
      });
      return res.json({ bookmarked: false });
    }

    await prisma.bookmarkCollage.create({
      data: { userId, collageId: id }
    });

    res.json({ bookmarked: true });
  })
);

// ─── GET /api/collages/:id/subscriptions (staff: list subscribers) ────────────

router.get(
  '/:id/subscriptions',
  ...requirePermission('collages_moderate'),
  validateParams(idParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const collage = await prisma.collage.findUnique({ where: { id } });
    if (!collage) return res.status(404).json({ msg: 'Collage not found' });

    const subs = await prisma.collageSubscription.findMany({
      where: { collageId: id },
      include: { user: { select: { id: true, username: true } } },
      orderBy: { lastVisit: 'desc' }
    });

    res.json(subs);
  })
);

export default router;
