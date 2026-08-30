import express, { Request, Response } from 'express';
import { z } from 'zod';
import { RegistrationStatus, StatSnapshotPeriod } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { AppError } from '../../../lib/errors';
import type { AuthenticatedRequest } from '../../../types/auth';
import { audit } from '../../../lib/audit';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { getCommunityHealthPulse } from '../../../modules/linkHealth';
import { getCommunityHealthHistory } from '../../../modules/communityHealthHistory';
import {
  communityRoleUnion,
  hasCommunityAccess,
  listCommunityMembers
} from '../../../modules/communityAccess';
import { requireAuth } from '../../../middleware/auth';
import {
  requirePermission,
  loadPermissions
} from '../../../middleware/permissions';
import {
  parsedBody,
  validate,
  validateParams,
  validateQuery,
  parsedParams,
  parsedQuery
} from '../../../middleware/validate';
import {
  createCommunitySchema,
  updateCommunitySchema,
  type CreateCommunityInput,
  type UpdateCommunityInput
} from '../../../schemas/community';
import {
  parsedPage,
  paginatedResponse,
  paginationBase
} from '../../../lib/pagination';
import releaseRouter from './release';

/**
 * Load a community and assert the caller may administer its membership.
 *
 * The four membership routes — add/remove a consuming member, add/remove a
 * curator — carried this verbatim. Unlike the collage guards, every copy here
 * really was identical: same load, same 404, same permission pair, same 403
 * message, so there is nothing per-route to preserve by leaving it in place.
 *
 * ADR-0001 keeps `communities_manage`/`admin` as explicit permission reads
 * rather than a named role; a curator of *this* community passes on the
 * membership edge instead, which is why the check needs the loaded row.
 */
const assertCommunityAdminOrCurator = async (
  id: number,
  req: AuthenticatedRequest,
  res: Response
) => {
  const community = await prisma.community.findUnique({
    where: { id },
    include: { curators: { select: { id: true } } }
  });
  if (!community) throw new AppError(404, 'Community not found');

  const perms = await loadPermissions(req, res);
  const isAdmin = !!(perms['communities_manage'] || perms['admin']);
  const isCurator = community.curators.some((c) => c.id === req.user.id);
  if (!isAdmin && !isCurator) throw new AppError(403, 'Permission denied');

  return community;
};

const router = express.Router();
const communityIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});
const memberParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive()
});
const addMemberSchema = z.object({
  userId: z.number().int().positive()
});

router.use('/:communityId/releases', releaseRouter);

const communitiesQuerySchema = z.object({ ...paginationBase });
const healthHistoryQuerySchema = z.object({
  period: z.nativeEnum(StatSnapshotPeriod).default(StatSnapshotPeriod.Daily)
});

// GET /api/communities — only returns communities the user can access
router.get(
  '/',
  requireAuth,
  validateQuery(communitiesQuerySchema),
  authHandler(async (req, res) => {
    const pg = parsedPage(res);
    const userId = req.user.id;
    // Same union the gates use (#419), so a curator-only member sees the
    // communities they administer instead of only the ones they consume.
    const accessFilter = {
      OR: [
        { registrationStatus: RegistrationStatus.open },
        communityRoleUnion(userId)
      ]
    };
    const [communities, total] = await Promise.all([
      prisma.community.findMany({
        where: accessFilter,
        skip: pg.skip,
        take: pg.limit,
        include: {
          curators: { select: { id: true, username: true } },
          _count: {
            select: { contributors: true, releases: true, consumers: true }
          }
        }
      }),
      prisma.community.count({ where: accessFilter })
    ]);
    paginatedResponse(res, communities, total, pg);
  })
);

// GET /api/communities/:id
router.get(
  '/:id',
  requireAuth,
  validateParams(communityIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const community = await prisma.community.findUnique({
      where: { id },
      include: {
        curators: { select: { id: true, username: true } },
        _count: {
          select: { contributors: true, releases: true, consumers: true }
        }
      }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    if (
      !(await hasCommunityAccess(id, req.user.id, community.registrationStatus))
    ) {
      return res.status(403).json({ msg: 'Not a member of this community' });
    }
    // `members` replaces the `consumers[]`-plus-Staff-chip idiom the UI used to
    // reconstruct a roster from (ADR-0033 §Decision 4). Loaded after the gate so
    // a 403 costs nothing extra; `_count` stays relation counts, which is what
    // it always was.
    res.json({ ...community, members: await listCommunityMembers(id) });
  })
);

// GET /api/communities/:id/health — the community's link-health pulse
router.get(
  '/:id/health',
  requireAuth,
  validateParams(communityIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const community = await prisma.community.findUnique({
      where: { id },
      select: { registrationStatus: true }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    if (
      !(await hasCommunityAccess(id, req.user.id, community.registrationStatus))
    ) {
      return res.status(403).json({ msg: 'Not a member of this community' });
    }
    res.json(await getCommunityHealthPulse(id));
  })
);

// GET /api/communities/:id/health/history — the pulse over time (#75).
// ?period=Daily|Monthly|Yearly (default Daily). Same membership gate as /health.
router.get(
  '/:id/health/history',
  requireAuth,
  validateParams(communityIdParamsSchema),
  validateQuery(healthHistoryQuerySchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { period } = parsedQuery<{ period: StatSnapshotPeriod }>(res);
    const community = await prisma.community.findUnique({
      where: { id },
      select: { registrationStatus: true }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    if (
      !(await hasCommunityAccess(id, req.user.id, community.registrationStatus))
    ) {
      return res.status(403).json({ msg: 'Not a member of this community' });
    }
    res.json(await getCommunityHealthHistory(id, period));
  })
);

// POST /api/communities/:id/members — add a consuming member (communities_manage or curator)
router.post(
  '/:id/members',
  requireAuth,
  validateParams(communityIdParamsSchema),
  validate(addMemberSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { userId } = parsedBody<{ userId: number }>(res);

    await assertCommunityAdminOrCurator(id, req, res);

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) return res.status(404).json({ msg: 'User not found' });

    const consumer = await prisma.consumer.upsert({
      where: { userId },
      create: { userId, communities: { connect: { id } } },
      update: { communities: { connect: { id } } }
    });
    res.status(201).json(consumer);
  })
);

// DELETE /api/communities/:id/members/:userId — remove a consuming member (communities_manage or curator)
router.delete(
  '/:id/members/:userId',
  requireAuth,
  validateParams(memberParamsSchema),
  authHandler(async (req, res) => {
    const { id, userId } = parsedParams<{ id: number; userId: number }>(res);

    const community = await assertCommunityAdminOrCurator(id, req, res);

    // This route operates on the Consumer link only. When the target also holds
    // a curator or leader role, refuse rather than partially removing them: no
    // route strips a role as a side effect of removing a membership
    // (ADR-0033 §Decision 5). Curators go through DELETE /:id/curators/:userId,
    // the leader through PUT /:id.
    // Leader is checked first: it is the role that has to be reassigned, and
    // the invariant means a leader is always also a curator.
    let blockingRole: string | null = null;
    if (community.leaderId === userId) blockingRole = 'leader';
    else if (community.curators.some((c) => c.id === userId))
      blockingRole = 'curator';
    if (blockingRole) {
      return res.status(409).json({
        msg: `User is the community ${blockingRole}; remove that role first`
      });
    }

    const consumer = await prisma.consumer.findUnique({ where: { userId } });
    if (!consumer) return res.status(404).json({ msg: 'User not found' });

    await prisma.consumer.update({
      where: { userId },
      data: { communities: { disconnect: { id } } }
    });
    res.status(204).send();
  })
);

// POST /api/communities/:id/curators — add a curator (communities_manage or curator)
router.post(
  '/:id/curators',
  requireAuth,
  validateParams(communityIdParamsSchema),
  validate(addMemberSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { userId } = parsedBody<{ userId: number }>(res);

    await assertCommunityAdminOrCurator(id, req, res);

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) return res.status(404).json({ msg: 'User not found' });

    await prisma.community.update({
      where: { id },
      data: { curators: { connect: { id: userId } } }
    });
    res.status(204).send();
  })
);

// DELETE /api/communities/:id/curators/:userId — remove a curator (communities_manage or curator)
router.delete(
  '/:id/curators/:userId',
  requireAuth,
  validateParams(memberParamsSchema),
  authHandler(async (req, res) => {
    const { id, userId } = parsedParams<{ id: number; userId: number }>(res);

    await assertCommunityAdminOrCurator(id, req, res);

    await prisma.community.update({
      where: { id },
      data: { curators: { disconnect: { id: userId } } }
    });
    res.status(204).send();
  })
);

// POST /api/communities — requires communities_manage
router.post(
  '/',
  ...requirePermission('communities_manage'),
  validate(createCommunitySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const {
      name,
      description,
      image,
      type,
      registrationStatus,
      announceVisibility,
      allowDuplicateFormats,
      curatorIds,
      leaderId
    } = parsedBody<CreateCommunityInput>(res);

    if (leaderId !== undefined) {
      const leader = await prisma.user.findUnique({ where: { id: leaderId } });
      if (!leader)
        return res.status(404).json({ msg: 'Leader user not found' });
    }

    const defaultImages: Record<string, string> = {
      Music: '/images/defaults/music.png',
      Applications: '/images/defaults/applications.png',
      EBooks: '/images/defaults/ebooks.png',
      ELearningVideos: '/images/defaults/elearning.png',
      Audiobooks: '/images/defaults/audiobooks.png',
      Comedy: '/images/defaults/comedy.png',
      Comics: '/images/defaults/comics.png'
    };

    // Leader is a superset of curators (ADR-0021): always fold into the set.
    const allCuratorIds = [
      ...(curatorIds ?? []),
      ...(leaderId !== undefined ? [leaderId] : [])
    ];

    const community = await prisma.community.create({
      data: {
        name,
        ...(description !== undefined && { description }),
        type,
        registrationStatus,
        image: image ?? defaultImages[type] ?? '/images/defaults/music.png',
        ...(announceVisibility !== undefined && { announceVisibility }),
        ...(allowDuplicateFormats !== undefined && { allowDuplicateFormats }),
        ...(leaderId !== undefined && { leaderId }),
        ...(allCuratorIds.length && {
          curators: {
            connect: [...new Set(allCuratorIds)].map((cid) => ({ id: cid }))
          }
        })
      }
    });

    // No Consumer is written for the leader (ADR-0033 §Decision 3). That upsert
    // existed only so the old `consumer ∪ contributor` checks would pass; the
    // role union reads `curators` directly, and asserting that a leader consumes
    // releases may simply be false.
    if (leaderId !== undefined) {
      await audit(
        prisma,
        req.user!.id,
        'community.leader.set',
        'community',
        community.id,
        { leaderId }
      );
    }

    res.status(201).json(community);
  })
);

// PUT /api/communities/:id — requires communities_manage
router.put(
  '/:id',
  ...requirePermission('communities_manage'),
  validateParams(communityIdParamsSchema),
  validate(updateCommunitySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const existing = await prisma.community.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Community not found' });

    const {
      name,
      description,
      image,
      registrationStatus,
      announceVisibility,
      allowDuplicateFormats,
      curatorIds,
      leaderId
    } = parsedBody<UpdateCommunityInput>(res);

    if (leaderId !== undefined) {
      const leader = await prisma.user.findUnique({ where: { id: leaderId } });
      if (!leader)
        return res.status(404).json({ msg: 'Leader user not found' });
    }

    // `curatorIds` (when given) replaces the whole curator set, so the new leader
    // might not be in it — fold them back in to preserve the leader ⊇ curators
    // invariant (ADR-0021, narrowed by ADR-0033).
    const curatorConnect =
      leaderId !== undefined && curatorIds !== undefined
        ? [...new Set([...curatorIds, leaderId])]
        : curatorIds;

    const community = await prisma.community.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(image !== undefined && { image }),
        ...(registrationStatus !== undefined && { registrationStatus }),
        ...(announceVisibility !== undefined && { announceVisibility }),
        ...(allowDuplicateFormats !== undefined && { allowDuplicateFormats }),
        ...(leaderId !== undefined && { leaderId }),
        ...(curatorConnect !== undefined && {
          curators: { set: curatorConnect.map((cid: number) => ({ id: cid })) }
        }),
        // Leader given but curator set untouched: connect (don't replace) so the
        // invariant holds without disturbing existing curators.
        ...(leaderId !== undefined &&
          curatorIds === undefined && {
            curators: { connect: { id: leaderId } }
          })
      }
    });

    // No Consumer upsert here either — see the create path (ADR-0033 §3).
    if (leaderId !== undefined) {
      await audit(
        prisma,
        req.user!.id,
        'community.leader.set',
        'community',
        community.id,
        { leaderId, previousLeaderId: existing.leaderId }
      );
    }

    res.json(community);
  })
);

// DELETE /api/communities/:id — requires communities_manage
router.delete(
  '/:id',
  ...requirePermission('communities_manage'),
  validateParams(communityIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const existing = await prisma.community.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Community not found' });
    await prisma.community.delete({ where: { id } });
    res.status(204).send();
  })
);

export default router;
