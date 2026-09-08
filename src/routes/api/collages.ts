import express, { Request, Response } from 'express';
import { AppError } from '../../lib/errors';
import { getUserRankQuotas } from '../../lib/userRankAccess';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { emitNotifications } from '../../lib/notifications';
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
import {
  releaseCreditsSelect,
  withPrimaryArtist
} from '../../modules/releaseCredits';
import { sanitizeHtml } from '../../lib/sanitize';
import { renderSiteBBCode, resolveViewer } from '../../modules/bbcodeRender';
import {
  parsedPage,
  paginatedResponse,
  paginationBase
} from '../../lib/pagination';
import { hasPermission } from '../../lib/rankPermissions';
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

/**
 * The three permissions that let someone act on a collage they do not own.
 * Spelled out once rather than at each of the six call sites — ADR-0001 keeps
 * these as explicit permission reads rather than a named role, so the list is
 * the thing worth having in one place.
 */
const hasCollageStaffPermission = (perms: Record<string, boolean>): boolean =>
  !!(perms['collages_moderate'] || perms['staff'] || perms['admin']);

/**
 * Load a collage that is visible to a non-staff actor, or 404.
 *
 * Deliberately does *not* carry the owner/staff authorization with it: the five
 * routes that share this load each gate differently afterwards — plain
 * "Permission denied", a locked-collage check, a personal-collage owner check,
 * a reorder-specific message — and folding those together would either change
 * the message a client sees or quietly widen a gate. Only the load and the
 * not-found case are actually common, so only those move.
 *
 * The GET detail route is not a caller: it deliberately lets staff read a
 * soft-deleted collage, which this rejects.
 */
const loadActiveCollage = async (id: number) => {
  const collage = await prisma.collage.findUnique({ where: { id } });
  if (!collage || collage.isDeleted)
    throw new AppError(404, 'Collage not found');
  return collage;
};

/**
 * The three staff-gated fields, written into `data` in place. Returns the
 * refusal when a non-staff caller sends one, else `null`. Split out of
 * `buildCollageUpdate` purely to keep both inside Codacy's per-function limits.
 */
const applyStaffOnlyFields = (
  updates: UpdateCollageInput,
  staff: boolean,
  data: Record<string, unknown>
): { status: number; msg: string } | null => {
  const gated = [
    ['isLocked', 'Only staff can lock collages'],
    ['maxEntries', 'Only staff can set entry limits'],
    ['maxEntriesPerUser', 'Only staff can set per-user limits']
  ] as const;

  for (const [field, msg] of gated) {
    const value = updates[field];
    if (value === undefined) continue;
    if (!staff) return { status: 403, msg };
    data[field] = value;
  }
  return null;
};

/**
 * Build the `data` for a collage update, or the refusal that stops it.
 *
 * A pure move of the handler's field-by-field gating — same conditions, same
 * order, same messages. Extracted because adding the #564 guard took the
 * handler to nloc 81 / ccn 22, well past Codacy's 50/10, and the guard itself
 * cannot move: it has to sit lexically in the handler for the guard-coverage
 * checker to see it.
 */
const buildCollageUpdate = async (args: {
  updates: UpdateCollageInput;
  collage: { categoryId: number };
  id: number;
  userId: number;
  staff: boolean;
}): Promise<
  { error: { status: number; msg: string } } | { data: Record<string, unknown> }
> => {
  const { updates, collage, id, userId, staff } = args;
  const data: Record<string, unknown> = {};

  // Name: owner of personal collage or staff only
  if (updates.name !== undefined) {
    if (!staff && !isPersonal(collage.categoryId)) {
      return {
        error: { status: 403, msg: 'Only staff can rename public collages' }
      };
    }
    const conflict = await prisma.collage.findFirst({
      where: { name: updates.name, isDeleted: false, id: { not: id } }
    });
    if (conflict) {
      return { error: { status: 409, msg: 'Collage name already taken' } };
    }
    data.name = updates.name;
  }

  if (updates.description !== undefined)
    data.description = sanitizeHtml(updates.description);
  if (updates.tags !== undefined) data.tags = updates.tags;

  // isFeatured: only for personal collages, mutually exclusive
  if (updates.isFeatured !== undefined) {
    if (!isPersonal(collage.categoryId))
      return {
        error: {
          status: 400,
          msg: 'Featured only applies to personal collages'
        }
      };
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
  const refusal = applyStaffOnlyFields(updates, staff, data);
  if (refusal) return { error: refusal };

  return { data };
};

/**
 * Everything that can refuse an entry add, as a status + message, or `null` when
 * the add may proceed. Extracted from the handler so it stays inside Codacy's
 * per-function limits once its #564 guard is added: a guard must sit lexically
 * in the handler for the guard-coverage checker to see it, so the room has to
 * come from elsewhere.
 *
 * These are READS, so each leaves a window the guard still has to close — they
 * make the common answers precise, they do not make the write safe.
 */
const entryAddBlocked = async (args: {
  collage: {
    id: number;
    maxEntries: number;
    numEntries: number;
    maxEntriesPerUser: number;
  };
  releaseId: number;
  userId: number;
  staff: boolean;
}): Promise<{ status: number; msg: string } | null> => {
  const { collage, releaseId, userId, staff } = args;

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: { id: true }
  });
  if (!release) return { status: 404, msg: 'Release not found' };

  const existing = await prisma.collageEntry.findUnique({
    where: { collageId_releaseId: { collageId: collage.id, releaseId } },
    select: { id: true }
  });
  if (existing) return { status: 409, msg: 'Release already in collage' };

  if (staff) return null;

  if (collage.maxEntries > 0 && collage.numEntries >= collage.maxEntries) {
    return { status: 400, msg: 'Collage has reached its maximum entry count' };
  }

  if (collage.maxEntriesPerUser > 0) {
    const userCount = await prisma.collageEntry.count({
      where: { collageId: collage.id, userId }
    });
    if (userCount >= collage.maxEntriesPerUser) {
      return { status: 400, msg: 'You have reached your per-user entry limit' };
    }
  }

  return null;
};

/**
 * Is an ACTIVE collage already using this name? Soft-deleted rows keep their
 * name, so this is deliberately narrower than the unique constraint the #564
 * guard catches — the two answer different questions and both are wanted.
 */
const nameTaken = async (name: string): Promise<boolean> =>
  // Truthiness, not `!== null`: an absent row is undefined, and treating that as
  // "taken" refuses every create. A test caught it; the original was truthy too.
  !!(await prisma.collage.findFirst({
    where: { name, isDeleted: false },
    select: { id: true }
  }));

/**
 * The personal-collage cap, as a message when it is exceeded and `null` when it
 * is not. Extracted from the create handler rather than inlined so that handler
 * stays inside Codacy's per-function nloc/ccn limits once its #564 guard is
 * added — a guard has to sit lexically in the handler for the guard-coverage
 * checker to see it, so the room has to come from somewhere else.
 *
 * The limit is resolved across primary + secondary ranks with 0 meaning
 * unlimited — the same resolver the auth payload advertises with, so the number
 * a member is shown is the number enforced (#369, ADR-0032 §4).
 */
const personalCollageQuotaExceeded = async (
  categoryId: number,
  perms: Record<string, boolean>,
  userId: number
): Promise<string | null> => {
  if (!isPersonal(categoryId)) return null;
  if (perms['staff'] || perms['admin']) return null;

  const { personalCollageLimit } = await getUserRankQuotas(userId);
  if (personalCollageLimit === null) return null;

  const count = await prisma.collage.count({
    where: { userId, categoryId: 0, isDeleted: false }
  });
  return count >= personalCollageLimit
    ? `Personal collage limit reached (${personalCollageLimit})`
    : null;
};

const router = express.Router();

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const entryParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  releaseId: z.coerce.number().int().positive()
});

const collageInclude = {
  user: { select: { id: true, username: true, avatar: true } },
  _count: { select: { entries: true, subscriptions: true, bookmarks: true } }
};

// Personal collages: categoryId === 0
const isPersonal = (categoryId: number) => categoryId === 0;

const deletedCollagesQuerySchema = z.object({ ...paginationBase });

// ─── GET /api/collages/deleted — staff recovery list (before /:id) ───────────

router.get(
  '/deleted',
  ...requirePermission('collages_moderate'),
  validateQuery(deletedCollagesQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsedPage(res);
    const [collages, total] = await Promise.all([
      prisma.collage.findMany({
        where: { isDeleted: true, categoryId: { gt: 0 } },
        skip: pg.skip,
        take: pg.limit,
        orderBy: { deletedAt: 'desc' },
        include: { user: { select: { id: true, username: true } } }
      }),
      prisma.collage.count({
        where: { isDeleted: true, categoryId: { gt: 0 } }
      })
    ]);
    paginatedResponse(res, collages, total, pg);
  })
);

// ─── GET /api/collages ────────────────────────────────────────────────────────

router.get(
  '/',
  requireAuth,
  validateQuery(collageQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const { search, categoryId, userId, bookmarked, orderBy, order } =
      parsedQuery<CollageQueryInput>(res);
    const pg = parsedPage(res);

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

    // Resolved ONCE for the request: this list renders in a loop, so a per-row
    // lookup would issue one identical settings query per row (#400).
    const bbViewer = await resolveViewer(req);
    const mapped = await Promise.all(
      collages.map(async (collage) => ({
        ...collage,
        descriptionHtml: await renderSiteBBCode(collage.description, bbViewer)
      }))
    );
    paginatedResponse(res, mapped, total, pg);
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
                communityId: true,
                releaseType: true,
                credits: releaseCreditsSelect
              }
            },
            user: { select: { id: true, username: true } }
          }
        }
      }
    });

    if (!collage) return res.status(404).json({ msg: 'Collage not found' });

    const perms = await loadPermissions(authReq, res);
    const staff = hasCollageStaffPermission(perms);

    if (collage.isDeleted && !staff) {
      return res.status(404).json({ msg: 'Collage not found' });
    }

    // For personal collages, only owner or staff can view
    if (isPersonal(collage.categoryId)) {
      if (collage.userId !== authReq.user.id && !staff) {
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
      // updateMany, not update: this is a best-effort side effect on a READ. If
      // the subscription is removed between the findUnique above and here,
      // `update` raises P2025 and the whole GET 500s (#564, arm B). No-opping is
      // the right answer — the caller asked for the collage, not the marker.
      await prisma.collageSubscription.updateMany({
        where: { userId: authReq.user.id, collageId: id },
        data: { lastVisit: new Date() }
      });
    }

    res.json({
      ...collage,
      descriptionHtml: await renderSiteBBCode(
        collage.description,
        await resolveViewer(req)
      ),
      entries: collage.entries.map((entry) => ({
        ...entry,
        release: withPrimaryArtist(entry.release)
      })),
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

    const perms = await loadPermissions(req, res);
    if (!hasPermission(perms, 'collages_create')) {
      return res.status(403).json({ msg: 'Permission denied' });
    }

    if (await nameTaken(name)) {
      return res
        .status(409)
        .json({ msg: 'A collage with this name already exists' });
    }

    const overQuota = await personalCollageQuotaExceeded(
      categoryId,
      perms,
      userId
    );
    if (overQuota !== null) {
      return res.status(400).json({ msg: overQuota });
    }

    let collage;
    try {
      collage = await prisma.collage.create({
        data: {
          name,
          description: sanitizeHtml(description),
          userId,
          categoryId,
          tags
        },
        include: collageInclude
      });
    } catch (err) {
      // `Collage.name` carries a unique constraint, so a duplicate name raised
      // P2002 and answered 500 (#564, arm A). The only foreign key is `userId`,
      // taken from the session, so P2003 is unreachable here.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new AppError(409, 'A collage with that name already exists');
      }
      throw err;
    }

    res.status(201).json({
      ...collage,
      descriptionHtml: await renderSiteBBCode(
        collage.description,
        await resolveViewer(req)
      )
    });
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
    const perms = await loadPermissions(req, res);
    const staff = hasCollageStaffPermission(perms);

    const collage = await loadActiveCollage(id);

    const isOwner = collage.userId === userId;
    if (!isOwner && !staff)
      return res.status(403).json({ msg: 'Permission denied' });

    const built = await buildCollageUpdate({
      updates,
      collage,
      id,
      userId,
      staff
    });
    if ('error' in built) {
      return res.status(built.error.status).json({ msg: built.error.msg });
    }
    const data = built.data;

    let updated;
    try {
      updated = await prisma.collage.update({
        where: { id },
        data,
        include: collageInclude
      });
    } catch (err) {
      // loadActiveCollage above is a READ, so it leaves the window this closes.
      // #564 treats a prior read as insufficient for exactly this reason.
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') throw new AppError(404, 'Collage not found');
        if (err.code === 'P2002') {
          throw new AppError(409, 'A collage with that name already exists');
        }
      }
      throw err;
    }

    res.json({
      ...updated,
      descriptionHtml: await renderSiteBBCode(
        updated.description,
        await resolveViewer(req)
      )
    });
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
    const perms = await loadPermissions(req, res);
    const staff = hasCollageStaffPermission(perms);

    const collage = await loadActiveCollage(id);

    const isOwner = collage.userId === userId;
    if (!isOwner && !staff)
      return res.status(403).json({ msg: 'Permission denied' });

    // Soft delete public collages (staff only); personal ones are hard deleted.
    // `isOwner || staff` is already guaranteed by the 403 above, so the personal
    // check alone decides the arm.
    const hardDelete = isPersonal(collage.categoryId);
    if (!hardDelete && !staff)
      return res
        .status(403)
        .json({ msg: 'Only staff can delete public collages' });

    // One try over both arms: loadActiveCollage above is a READ, so either write
    // can meet a row that has since gone, and P2025 would reach the global
    // handler as a 500 (#564).
    try {
      if (hardDelete) {
        await prisma.collage.delete({ where: { id } });
      } else {
        await prisma.collage.update({
          where: { id },
          data: { isDeleted: true, deletedAt: new Date() }
        });
      }
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new AppError(404, 'Collage not found');
      }
      throw err;
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

    let updated;
    try {
      updated = await prisma.collage.update({
        where: { id },
        data: { isDeleted: false, deletedAt: null },
        include: collageInclude
      });
    } catch (err) {
      // loadActiveCollage above is a READ; this closes the window it leaves,
      // where P2025 would otherwise reach the global handler as a 500 (#564).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new AppError(404, 'Collage not found');
      }
      throw err;
    }

    res.json({
      ...updated,
      descriptionHtml: await renderSiteBBCode(
        updated.description,
        await resolveViewer(req)
      )
    });
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
    const perms = await loadPermissions(req, res);
    const staff = hasCollageStaffPermission(perms);

    const collage = await loadActiveCollage(id);

    // Locked check
    if (collage.isLocked && !staff)
      return res.status(403).json({ msg: 'Collage is locked' });

    // Personal collage: only owner (or staff) can add
    if (isPersonal(collage.categoryId) && collage.userId !== userId && !staff)
      return res
        .status(403)
        .json({ msg: 'Only the owner can add to a personal collage' });

    const blocked = await entryAddBlocked({
      collage,
      releaseId,
      userId,
      staff
    });
    if (blocked) return res.status(blocked.status).json({ msg: blocked.msg });

    // Get max sort value for new entry
    const maxSort = await prisma.collageEntry.aggregate({
      where: { collageId: id },
      _max: { sort: true }
    });
    const nextSort = (maxSort._max.sort ?? 0) + 10;

    let entry;
    try {
      entry = await prisma.$transaction(async (tx) => {
        const created = await tx.collageEntry.create({
          data: { collageId: id, releaseId, userId, sort: nextSort },
          include: {
            release: {
              select: {
                id: true,
                title: true,
                image: true,
                year: true,
                releaseType: true,
                credits: releaseCreditsSelect
              }
            },
            user: { select: { id: true, username: true } }
          }
        });
        await tx.collage.update({
          where: { id },
          data: { numEntries: { increment: 1 } }
        });

        const subs = await tx.collageSubscription.findMany({
          where: { collageId: id },
          select: { userId: true }
        });
        await emitNotifications(tx, {
          userIds: subs.map((s) => s.userId),
          type: 'collage_updated',
          actorId: userId,
          page: 'collages',
          pageId: id
        });

        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        // The release and duplicate checks above are reads; both windows stay
        // open until the write lands (#564). `collageId` and `releaseId` are
        // path/body ids, `userId` is session-derived.
        if (err.code === 'P2003') {
          throw new AppError(404, 'Collage or release not found');
        }
        if (err.code === 'P2002') {
          throw new AppError(409, 'Release already in collage');
        }
        if (err.code === 'P2025') {
          throw new AppError(404, 'Collage not found');
        }
      }
      throw err;
    }

    res.status(201).json({
      ...entry,
      release: withPrimaryArtist(entry.release)
    });
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
    const perms = await loadPermissions(req, res);
    const staff = hasCollageStaffPermission(perms);

    const collage = await loadActiveCollage(id);

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

    try {
      await prisma.$transaction([
        prisma.collageEntry.delete({
          where: { collageId_releaseId: { collageId: id, releaseId } }
        }),
        prisma.collage.update({
          where: { id },
          data: { numEntries: { decrement: 1 } }
        })
      ]);
    } catch (err) {
      // Both writes are addressed by id after reads, so either can meet a row
      // that has since gone. Rolling back leaves the counter consistent; the
      // 500 it used to answer did not (#564, arm B).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new AppError(404, 'Collage entry not found');
      }
      throw err;
    }

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
    const perms = await loadPermissions(req, res);
    const staff = hasCollageStaffPermission(perms);

    const collage = await loadActiveCollage(id);

    const isOwner = collage.userId === userId;
    if (!isOwner && !staff)
      return res
        .status(403)
        .json({ msg: 'Only the collage owner or staff can reorder entries' });

    try {
      await prisma.$transaction(
        entries.map(({ id: entryId, sort }) =>
          prisma.collageEntry.update({
            where: { id: entryId },
            data: { sort }
          })
        )
      );
    } catch (err) {
      // The entry ids come from the BODY and none is read first, so a reorder
      // naming an entry that does not exist answered 500 (#564, arm B).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new AppError(400, 'One or more entries not found');
      }
      throw err;
    }

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

    // Existence/visibility check only — the collage row itself is not needed.
    await loadActiveCollage(id);

    const existing = await prisma.collageSubscription.findUnique({
      where: { userId_collageId: { userId, collageId: id } }
    });

    if (existing) {
      // Unsubscribe
      try {
        await prisma.$transaction([
          prisma.collageSubscription.delete({
            where: { userId_collageId: { userId, collageId: id } }
          }),
          prisma.collage.update({
            where: { id },
            data: { numSubscribers: { decrement: 1 } }
          })
        ]);
      } catch (err) {
        // A concurrent unsubscribe already did what this caller asked for, so
        // report the resulting state rather than a conflict — the same reading
        // as the /bookmarks toggle (#564).
        if (!(
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2025'
        )) {
          throw err;
        }
      }
      return res.json({ subscribed: false });
    }

    // Subscribe
    try {
      await prisma.$transaction([
        prisma.collageSubscription.create({
          data: { userId, collageId: id }
        }),
        prisma.collage.update({
          where: { id },
          data: { numSubscribers: { increment: 1 } }
        })
      ]);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        // A concurrent subscribe won: the caller is subscribed either way.
        if (err.code === 'P2002') return res.json({ subscribed: true });
        // The collage went away between loadActiveCollage and here.
        if (err.code === 'P2003' || err.code === 'P2025') {
          throw new AppError(404, 'Collage not found');
        }
      }
      throw err;
    }

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

    // Existence/visibility check only — the collage row itself is not needed.
    await loadActiveCollage(id);

    const existing = await prisma.bookmarkCollage.findUnique({
      where: { userId_collageId: { userId, collageId: id } }
    });

    if (existing) {
      // deleteMany, not delete: no-ops if a concurrent request already removed
      // it, where `delete` would raise P2025 and 500 (#564, arm B). Same shape
      // as the /bookmarks toggles.
      await prisma.bookmarkCollage.deleteMany({
        where: { userId, collageId: id }
      });
      return res.json({ bookmarked: false });
    }

    try {
      await prisma.bookmarkCollage.create({
        data: { userId, collageId: id }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        // A concurrent POST won the race; the bookmark exists either way.
        if (err.code === 'P2002') return res.json({ bookmarked: true });
        if (err.code === 'P2003') {
          throw new AppError(404, 'Collage not found');
        }
      }
      throw err;
    }

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
