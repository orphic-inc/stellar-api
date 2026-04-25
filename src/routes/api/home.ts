import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';

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
        where: { artist: { vanityHouse: true } },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          year: true,
          image: true,
          communityId: true,
          artist: { select: { id: true, name: true } }
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
              artist: { select: { id: true, name: true } }
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
                  release
                }
              : null
          )
      : null;

    res.json({
      albumOfTheMonth,
      vanityHouse: vanityHouseRelease
    });
  })
);

export default router;
