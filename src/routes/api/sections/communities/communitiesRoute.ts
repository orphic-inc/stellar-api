import express, { Request, Response } from 'express';
import { check, validationResult } from 'express-validator';
import { CommunityType, RegistrationStatus } from '@prisma/client';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';
import communityGroupRouter from './communityGroup';

const router = express.Router();

router.use('/:communityId/groups', communityGroupRouter);

// GET /api/communities
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const communities = await prisma.community.findMany({
      include: { _count: { select: { contributors: true, releases: true } } }
    });
    res.json(communities);
  })
);

// GET /api/communities/:id
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const community = await prisma.community.findUnique({
      where: { id },
      include: {
        staff: { select: { id: true, username: true } },
        _count: { select: { contributors: true, releases: true, consumers: true } }
      }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    res.json(community);
  })
);

// POST /api/communities
router.post(
  '/',
  requireAuth,
  [
    check('name', 'Name is required').not().isEmpty(),
    check('type', 'Type is required').not().isEmpty(),
    check('registrationStatus', 'Registration status is required').not().isEmpty()
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, image, type, registrationStatus, staffIds } = req.body as {
      name: string; image?: string;
      type: CommunityType; registrationStatus: RegistrationStatus;
      staffIds?: number[];
    };

    const defaultImages: Record<CommunityType, string> = {
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
        name, type, registrationStatus,
        image: image ?? defaultImages[type],
        ...(staffIds?.length && { staff: { connect: staffIds.map((id) => ({ id })) } })
      }
    });
    res.json(community);
  })
);

// PUT /api/communities/:id
router.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const existing = await prisma.community.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Community not found' });

    const { name, image, registrationStatus, staffIds } = req.body;
    const community = await prisma.community.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(image !== undefined && { image }),
        ...(registrationStatus !== undefined && { registrationStatus }),
        ...(staffIds !== undefined && { staff: { set: staffIds.map((sid: number) => ({ id: sid })) } })
      }
    });
    res.json(community);
  })
);

export default router;
