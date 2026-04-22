import express, { Request, Response } from 'express';
import { check, validationResult } from 'express-validator';
import { ReleaseType, ReleaseCategory } from '@prisma/client';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';

const router = express.Router({ mergeParams: true });

// GET /api/communities/:communityId/groups
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const communityId = parseInt(req.params.communityId);
    if (isNaN(communityId)) return res.status(400).json({ msg: 'Invalid community id' });
    const releases = await prisma.release.findMany({
      where: { communityId },
      include: {
        artist: { select: { id: true, name: true } },
        tags: true,
        contributors: { include: { user: { select: { id: true, username: true } } } }
      }
    });
    res.json(releases);
  })
);

// GET /api/communities/:communityId/groups/:groupId
router.get(
  '/:groupId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const communityId = parseInt(req.params.communityId);
    const id = parseInt(req.params.groupId);
    if (isNaN(communityId) || isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
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

// POST /api/communities/:communityId/groups
router.post(
  '/',
  requireAuth,
  [
    check('artistId', 'Artist id is required').isInt(),
    check('title', 'Title is required').not().isEmpty(),
    check('description', 'Description is required').not().isEmpty(),
    check('type', 'Type is required').not().isEmpty(),
    check('releaseType', 'Release type is required').not().isEmpty(),
    check('year', 'Year is required').isInt()
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const communityId = parseInt(req.params.communityId);
    const community = await prisma.community.findUnique({ where: { id: communityId } });
    if (!community) return res.status(404).json({ msg: 'Community not found' });

    const { artistId, title, description, type, releaseType, year, image, tagIds, isEdition, edition } = req.body as {
      artistId: number; title: string; description: string;
      type: ReleaseType; releaseType: ReleaseCategory;
      year: number; image?: string; tagIds?: number[];
      isEdition?: boolean; edition?: Record<string, unknown>;
    };

    const release = await prisma.release.create({
      data: {
        artistId, communityId, title, description, type, releaseType, year,
        image: image ?? null,
        isEdition: isEdition ?? false,
        edition: (edition ?? undefined) as never,
        ...(tagIds?.length && { tags: { connect: tagIds.map((id) => ({ id })) } })
      },
      include: { artist: true, tags: true }
    });
    res.status(201).json(release);
  })
);

// PUT /api/communities/:communityId/groups/:groupId
router.put(
  '/:groupId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const communityId = parseInt(req.params.communityId);
    const id = parseInt(req.params.groupId);
    if (isNaN(communityId) || isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });

    const existing = await prisma.release.findFirst({ where: { id, communityId } });
    if (!existing) return res.status(404).json({ msg: 'Release not found' });

    const { title, description, image, year, isEdition, edition, tagIds } = req.body;
    const release = await prisma.release.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(image !== undefined && { image }),
        ...(year !== undefined && { year }),
        ...(isEdition !== undefined && { isEdition }),
        ...(edition !== undefined && { edition }),
        ...(tagIds !== undefined && { tags: { set: tagIds.map((tid: number) => ({ id: tid })) } })
      },
      include: { artist: true, tags: true }
    });
    res.json(release);
  })
);

// DELETE /api/communities/:communityId/groups/:groupId
router.delete(
  '/:groupId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const communityId = parseInt(req.params.communityId);
    const id = parseInt(req.params.groupId);
    if (isNaN(communityId) || isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const existing = await prisma.release.findFirst({ where: { id, communityId } });
    if (!existing) return res.status(404).json({ msg: 'Release not found' });
    await prisma.release.delete({ where: { id } });
    res.json({ msg: 'Release deleted' });
  })
);

export default router;
