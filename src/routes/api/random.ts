import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import {
  releaseCreditsSelect,
  withPrimaryArtist
} from '../../modules/releaseCredits';
import { releaseVisibleToViewer } from '../../modules/communityAccess';

const router = Router();

// ─── GET /api/random/release ──────────────────────────────────────────────────

router.get(
  '/release',
  requireAuth,
  authHandler(async (req, res) => {
    // Viewer-scoped, not chart-scoped (ADR-0036 §4). Top 10 excludes private
    // communities for rank coherence; random has no ranking and no cache, so
    // that reasoning does not reach it — and a member being unable to draw
    // their OWN community's releases would be a loss with nothing bought.
    //
    // The scope goes on the count as well as the pick. A count that skipped it
    // would choose a `skip` beyond the filtered set and answer null.
    const where = releaseVisibleToViewer(req.user.id);
    const count = await prisma.release.count({ where });
    if (!count) return res.status(404).json({ msg: 'No releases found' });
    const release = await prisma.release.findFirst({
      where,
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
    const count = await prisma.artist.count({ where: { deletedAt: null } });
    if (!count) return res.status(404).json({ msg: 'No artists found' });
    const artist = await prisma.artist.findFirst({
      where: { deletedAt: null },
      skip: Math.floor(Math.random() * count),
      select: { id: true, name: true }
    });
    res.json(artist);
  })
);

export default router;
