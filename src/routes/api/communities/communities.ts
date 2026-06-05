import express, { Request, Response } from 'express';
import { z } from 'zod';
import { RegistrationStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { getCommunityHealthPulse } from '../../../modules/linkHealth';
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
  parsedParams
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

export async function isCommunityMember(
  communityId: number,
  userId: number,
  registrationStatus: RegistrationStatus
): Promise<boolean> {
  if (registrationStatus === RegistrationStatus.open) return true;
  const [consumer, contributor] = await Promise.all([
    prisma.consumer.findFirst({
      where: { userId, communities: { some: { id: communityId } } }
    }),
    prisma.contributor.findFirst({ where: { userId, communityId } })
  ]);
  return !!(consumer || contributor);
}

// GET /api/communities — only returns communities the user can access
router.get(
  '/',
  requireAuth,
  validateQuery(communitiesQuerySchema),
  authHandler(async (req, res) => {
    const pg = parsedPage(res);
    const userId = req.user.id;
    const memberFilter = {
      OR: [
        { registrationStatus: RegistrationStatus.open },
        { consumers: { some: { userId } } },
        { contributors: { some: { userId } } }
      ]
    };
    const [communities, total] = await Promise.all([
      prisma.community.findMany({
        where: memberFilter,
        skip: pg.skip,
        take: pg.limit,
        include: {
          staff: { select: { id: true, username: true } },
          _count: {
            select: { contributors: true, releases: true, consumers: true }
          }
        }
      }),
      prisma.community.count({ where: memberFilter })
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
        staff: { select: { id: true, username: true } },
        consumers: {
          select: { user: { select: { id: true, username: true } } }
        },
        _count: {
          select: { contributors: true, releases: true, consumers: true }
        }
      }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    if (
      !(await isCommunityMember(id, req.user.id, community.registrationStatus))
    ) {
      return res.status(403).json({ msg: 'Not a member of this community' });
    }
    res.json(community);
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
      !(await isCommunityMember(id, req.user.id, community.registrationStatus))
    ) {
      return res.status(403).json({ msg: 'Not a member of this community' });
    }
    res.json(await getCommunityHealthPulse(id));
  })
);

// POST /api/communities/:id/members — add user (communities_manage or community staff)
router.post(
  '/:id/members',
  requireAuth,
  validateParams(communityIdParamsSchema),
  validate(addMemberSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { userId } = parsedBody<{ userId: number }>(res);

    const community = await prisma.community.findUnique({
      where: { id },
      include: { staff: { select: { id: true } } }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });

    const perms = await loadPermissions(req, res);
    const isAdmin = !!(perms['communities_manage'] || perms['admin']);
    const isCommunityStaff = community.staff.some((s) => s.id === req.user.id);
    if (!isAdmin && !isCommunityStaff) {
      return res.status(403).json({ msg: 'Permission denied' });
    }

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

// DELETE /api/communities/:id/members/:userId — remove user (communities_manage or community staff)
router.delete(
  '/:id/members/:userId',
  requireAuth,
  validateParams(memberParamsSchema),
  authHandler(async (req, res) => {
    const { id, userId } = parsedParams<{ id: number; userId: number }>(res);

    const community = await prisma.community.findUnique({
      where: { id },
      include: { staff: { select: { id: true } } }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });

    const perms = await loadPermissions(req, res);
    const isAdmin = !!(perms['communities_manage'] || perms['admin']);
    const isCommunityStaff = community.staff.some((s) => s.id === req.user.id);
    if (!isAdmin && !isCommunityStaff) {
      return res.status(403).json({ msg: 'Permission denied' });
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

// POST /api/communities/:id/staff — add user to community staff (communities_manage or community staff)
router.post(
  '/:id/staff',
  requireAuth,
  validateParams(communityIdParamsSchema),
  validate(addMemberSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { userId } = parsedBody<{ userId: number }>(res);

    const community = await prisma.community.findUnique({
      where: { id },
      include: { staff: { select: { id: true } } }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });

    const perms = await loadPermissions(req, res);
    const isAdmin = !!(perms['communities_manage'] || perms['admin']);
    const isCommunityStaff = community.staff.some((s) => s.id === req.user.id);
    if (!isAdmin && !isCommunityStaff) {
      return res.status(403).json({ msg: 'Permission denied' });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) return res.status(404).json({ msg: 'User not found' });

    await prisma.community.update({
      where: { id },
      data: { staff: { connect: { id: userId } } }
    });
    res.status(204).send();
  })
);

// DELETE /api/communities/:id/staff/:userId — remove from community staff (communities_manage or community staff)
router.delete(
  '/:id/staff/:userId',
  requireAuth,
  validateParams(memberParamsSchema),
  authHandler(async (req, res) => {
    const { id, userId } = parsedParams<{ id: number; userId: number }>(res);

    const community = await prisma.community.findUnique({
      where: { id },
      include: { staff: { select: { id: true } } }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });

    const perms = await loadPermissions(req, res);
    const isAdmin = !!(perms['communities_manage'] || perms['admin']);
    const isCommunityStaff = community.staff.some((s) => s.id === req.user.id);
    if (!isAdmin && !isCommunityStaff) {
      return res.status(403).json({ msg: 'Permission denied' });
    }

    await prisma.community.update({
      where: { id },
      data: { staff: { disconnect: { id: userId } } }
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
      allowDuplicateFormats,
      staffIds,
      ownerId
    } = parsedBody<CreateCommunityInput>(res);

    if (ownerId !== undefined) {
      const owner = await prisma.user.findUnique({ where: { id: ownerId } });
      if (!owner) return res.status(404).json({ msg: 'Owner user not found' });
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

    const allStaffIds = [
      ...(staffIds ?? []),
      ...(ownerId !== undefined ? [ownerId] : [])
    ];

    const community = await prisma.community.create({
      data: {
        name,
        ...(description !== undefined && { description }),
        type,
        registrationStatus,
        image: image ?? defaultImages[type] ?? '/images/defaults/music.png',
        ...(allowDuplicateFormats !== undefined && { allowDuplicateFormats }),
        ...(allStaffIds.length && {
          staff: {
            connect: [...new Set(allStaffIds)].map((sid) => ({ id: sid }))
          }
        })
      }
    });

    if (ownerId !== undefined) {
      await prisma.consumer.upsert({
        where: { userId: ownerId },
        create: {
          userId: ownerId,
          communities: { connect: { id: community.id } }
        },
        update: { communities: { connect: { id: community.id } } }
      });
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
      allowDuplicateFormats,
      staffIds
    } = parsedBody<UpdateCommunityInput>(res);
    const community = await prisma.community.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(image !== undefined && { image }),
        ...(registrationStatus !== undefined && { registrationStatus }),
        ...(allowDuplicateFormats !== undefined && { allowDuplicateFormats }),
        ...(staffIds !== undefined && {
          staff: { set: staffIds.map((sid: number) => ({ id: sid })) }
        })
      }
    });
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
