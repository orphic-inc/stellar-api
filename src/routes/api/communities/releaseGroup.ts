import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import { validate, validateParams } from '../../../middleware/validate';
import {
  createGroupSchema,
  updateGroupSchema
} from '../../../schemas/community';
import { parsePage, paginatedResponse } from '../../../lib/pagination';

const router = express.Router({ mergeParams: true });
const communityIdParamsSchema = z.object({
  communityId: z.coerce.number().int().positive()
});
const releaseGroupParamsSchema = z.object({
  communityId: z.coerce.number().int().positive(),
  groupId: z.coerce.number().int().positive()
});

// GET /api/communities/:communityId/groups
router.get(
  '/',
  requireAuth,
  validateParams(communityIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId } = req.params as unknown as { communityId: number };
    const pg = parsePage(req);
    const [releases, total] = await Promise.all([
      prisma.release.findMany({
        where: { communityId },
        skip: pg.skip,
        take: pg.limit,
        include: {
          artist: { select: { id: true, name: true } },
          tags: true
        }
      }),
      prisma.release.count({ where: { communityId } })
    ]);
    paginatedResponse(res, releases, total, pg);
  })
);

// GET /api/communities/:communityId/groups/:groupId
router.get(
  '/:groupId',
  requireAuth,
  validateParams(releaseGroupParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId, groupId: id } = req.params as unknown as {
      communityId: number;
      groupId: number;
    };
    const release = await prisma.release.findFirst({
      where: { id, communityId },
      include: {
        artist: true,
        tags: true,
        contributions: {
          include: {
            user: { select: { id: true, username: true } },
            collaborators: true
          }
        }
      }
    });
    if (!release) return res.status(404).json({ msg: 'Release not found' });
    res.json(release);
  })
);

// POST /api/communities/:communityId/groups — requires communities_manage
router.post(
  '/',
  ...requirePermission('communities_manage'),
  validateParams(communityIdParamsSchema),
  validate(createGroupSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId } = req.params as unknown as { communityId: number };
    const community = await prisma.community.findUnique({
      where: { id: communityId }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });

    const {
      artistId,
      title,
      description,
      type,
      releaseType,
      year,
      image,
      tagIds,
      isEdition,
      edition
    } = req.body;

    const release = await prisma.release.create({
      data: {
        artistId,
        communityId,
        title,
        description,
        type,
        releaseType,
        year,
        image: image ?? null,
        isEdition: isEdition ?? false,
        edition: (edition ?? undefined) as never,
        ...(tagIds?.length && {
          tags: { connect: tagIds.map((tid: number) => ({ id: tid })) }
        })
      },
      include: { artist: true, tags: true }
    });
    res.status(201).json(release);
  })
);

// PUT /api/communities/:communityId/groups/:groupId — requires communities_manage
router.put(
  '/:groupId',
  ...requirePermission('communities_manage'),
  validateParams(releaseGroupParamsSchema),
  validate(updateGroupSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId, groupId: id } = req.params as unknown as {
      communityId: number;
      groupId: number;
    };

    const existing = await prisma.release.findFirst({
      where: { id, communityId }
    });
    if (!existing) return res.status(404).json({ msg: 'Release not found' });

    const { title, description, image, year, isEdition, edition, tagIds } =
      req.body;
    const release = await prisma.release.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(image !== undefined && { image }),
        ...(year !== undefined && { year }),
        ...(isEdition !== undefined && { isEdition }),
        ...(edition !== undefined && { edition }),
        ...(tagIds !== undefined && {
          tags: { set: tagIds.map((tid: number) => ({ id: tid })) }
        })
      },
      include: { artist: true, tags: true }
    });
    res.json(release);
  })
);

// DELETE /api/communities/:communityId/groups/:groupId — requires communities_manage
router.delete(
  '/:groupId',
  ...requirePermission('communities_manage'),
  validateParams(releaseGroupParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId, groupId: id } = req.params as unknown as {
      communityId: number;
      groupId: number;
    };
    const existing = await prisma.release.findFirst({
      where: { id, communityId }
    });
    if (!existing) return res.status(404).json({ msg: 'Release not found' });
    await prisma.release.delete({ where: { id } });
    res.status(204).send();
  })
);

export default router;
