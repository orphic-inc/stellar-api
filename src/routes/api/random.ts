import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../modules/asyncHandler';
import {
  releaseCreditsSelect,
  withPrimaryArtist
} from '../../modules/releaseCredits';

const router = Router();

// ─── GET /api/random/release ──────────────────────────────────────────────────

router.get(
  '/release',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const count = await prisma.release.count();
    if (!count) return res.status(404).json({ msg: 'No releases found' });
    const release = await prisma.release.findFirst({
      skip: Math.floor(Math.random() * count),
      select: {
        id: true,
        communityId: true,
        title: true,
        year: true,
        credits: releaseCreditsSelect
      }
    });
    res.json(release ? withPrimaryArtist(release) : null);
  })
);

// ─── GET /api/random/artist ───────────────────────────────────────────────────

router.get(
  '/artist',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const count = await prisma.artist.count();
    if (!count) return res.status(404).json({ msg: 'No artists found' });
    const artist = await prisma.artist.findFirst({
      skip: Math.floor(Math.random() * count),
      select: { id: true, name: true }
    });
    res.json(artist);
  })
);

export default router;
