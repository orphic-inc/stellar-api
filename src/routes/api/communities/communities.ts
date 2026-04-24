import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedParams
} from '../../../middleware/validate';
import {
  createCommunitySchema,
  updateCommunitySchema
} from '../../../schemas/community';
import { parsePage, paginatedResponse } from '../../../lib/pagination';
import releaseRouter from './release';

const router = express.Router();
const communityIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

router.use('/:communityId/releases', releaseRouter);

// GET /api/communities
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsePage(req);
    const [communities, total] = await Promise.all([
      prisma.community.findMany({
        skip: pg.skip,
        take: pg.limit,
        include: { _count: { select: { contributors: true, releases: true } } }
      }),
      prisma.community.count()
    ]);
    paginatedResponse(res, communities, total, pg);
  })
);

// GET /api/communities/:id
router.get(
  '/:id',
  requireAuth,
  validateParams(communityIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const community = await prisma.community.findUnique({
      where: { id },
      include: {
        staff: { select: { id: true, username: true } },
        _count: {
          select: { contributors: true, releases: true, consumers: true }
        }
      }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    res.json(community);
  })
);

// POST /api/communities — requires communities_manage
router.post(
  '/',
  ...requirePermission('communities_manage'),
  validate(createCommunitySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, image, type, registrationStatus, staffIds } = req.body;

    const defaultImages: Record<string, string> = {
      Music: '/images/defaults/music.png',
      Applications: '/images/defaults/applications.png',
      EBooks: '/images/defaults/ebooks.png',
      ELearningVideos: '/images/defaults/elearning.png',
      Audiobooks: '/images/defaults/audiobooks.png',
      Comedy: '/images/defaults/comedy.png',
      Comics: '/images/defaults/comics.png'
    };

    const community = await prisma.community.create({
      data: {
        name,
        type,
        registrationStatus,
        image: image ?? defaultImages[type],
        ...(staffIds?.length && {
          staff: { connect: staffIds.map((sid: number) => ({ id: sid })) }
        })
      }
    });
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

    const { name, image, registrationStatus, staffIds } = req.body;
    const community = await prisma.community.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(image !== undefined && { image }),
        ...(registrationStatus !== undefined && { registrationStatus }),
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
