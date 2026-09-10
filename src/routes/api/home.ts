import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import {
  releaseCreditsSelect,
  withPrimaryArtist
} from '../../modules/releaseCredits';
import { releaseInPublicCommunity } from '../../modules/communityAccess';

const router = express.Router();

// GET /api/home/featured
router.get(
  '/featured',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const now = new Date();

    const [featuredAlbum, vanityHouseRelease] = await Promise.all([
      prisma.featuredAlbum.findFirst({
        where: { started: { lte: now }, ended: { gte: now } },
        orderBy: { started: 'desc' }
      }),
      prisma.release.findFirst({
        // The vanity-house slot is NOT curation — it is a query for the most
        // recently updated release credited to a vanityHouse artist, so it
        // behaves like a ranking and takes the chart predicate (ADR-0036 §4).
        // Album of the Month, below, is the curated half and is governed
        // instead by a refusal at set time.
        where: {
          credits: { some: { artist: { vanityHouse: true } } },
          ...releaseInPublicCommunity
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          year: true,
          image: true,
          communityId: true,
          credits: releaseCreditsSelect
        }
      })
    ]);

    const albumOfTheMonth = featuredAlbum
      ? await prisma.release
          .findUnique({
            where: { id: featuredAlbum.groupId },
            select: {
              id: true,
              title: true,
              year: true,
              image: true,
              communityId: true,
              credits: releaseCreditsSelect
            }
          })
          .then((release) =>
            release
              ? {
                  id: release.id,
                  title: featuredAlbum.title || release.title,
                  started: featuredAlbum.started,
                  ended: featuredAlbum.ended,
                  threadId: featuredAlbum.threadId,
                  release: withPrimaryArtist({
                    ...release,
                    image: featuredAlbum.image || release.image
                  })
                }
              : null
          )
      : null;

    res.json({
      albumOfTheMonth,
      vanityHouse: vanityHouseRelease
        ? withPrimaryArtist(vanityHouseRelease)
        : null
    });
  })
);

export default router;
