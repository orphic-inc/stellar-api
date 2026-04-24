import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import {
  createArtistHistoryEntry,
  revertArtistFromHistory
} from '../../../modules/artist';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import {
  parsedBody,
  validate,
  validateParams,
  parsedParams
} from '../../../middleware/validate';
import { parsePage, paginatedResponse } from '../../../lib/pagination';
import {
  artistSchema,
  updateArtistSchema,
  similarArtistSchema,
  artistAliasSchema,
  artistTagSchema,
  type ArtistInput,
  type UpdateArtistInput,
  type SimilarArtistInput,
  type ArtistAliasInput,
  type ArtistTagInput
} from '../../../schemas/artist';

const router = express.Router();
const artistIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});
const artistHistoryParamsSchema = z.object({
  artistId: z.coerce.number().int().positive()
});
const artistRevertParamsSchema = z.object({
  historyId: z.coerce.number().int().positive()
});

// GET /api/artists
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsePage(req);
    const [artists, total] = await Promise.all([
      prisma.artist.findMany({
        skip: pg.skip,
        take: pg.limit,
        include: { _count: { select: { releases: true } } },
        orderBy: { name: 'asc' }
      }),
      prisma.artist.count()
    ]);
    paginatedResponse(res, artists, total, pg);
  })
);

// Static-segment routes MUST come before /:id to avoid being shadowed

// GET /api/artists/history/:artistId
router.get(
  '/history/:artistId',
  requireAuth,
  validateParams(artistHistoryParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { artistId } = parsedParams<{ artistId: number }>(res);
    const history = await prisma.artistHistory.findMany({
      where: { artistId },
      orderBy: { editedAt: 'desc' },
      include: { editedUser: { select: { id: true, username: true } } }
    });
    res.json(history);
  })
);

// POST /api/artists/revert/:historyId — requires communities_manage
router.post(
  '/revert/:historyId',
  ...requirePermission('communities_manage'),
  validateParams(artistRevertParamsSchema),
  authHandler(async (req, res) => {
    const { historyId } = parsedParams<{ historyId: number }>(res);
    const artist = await revertArtistFromHistory({
      historyId,
      editedBy: req.user.id
    });
    if (!artist)
      return res.status(404).json({ msg: 'History entry not found' });

    res.json({ msg: 'Artist reverted successfully', artist });
  })
);

// POST /api/artists/similar
router.post(
  '/similar',
  requireAuth,
  validate(similarArtistSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { artistId, similarArtistId } = parsedBody<SimilarArtistInput>(res);
    const result = await prisma.similarArtist.upsert({
      where: { artistId_similarArtistId: { artistId, similarArtistId } },
      create: { artistId, similarArtistId, votes: [] },
      update: {}
    });
    res.json(result);
  })
);

// POST /api/artists/alias
router.post(
  '/alias',
  requireAuth,
  validate(artistAliasSchema),
  authHandler(async (req, res) => {
    const { artistId, redirectId } = parsedBody<ArtistAliasInput>(res);
    const alias = await prisma.artistAlias.create({
      data: { artistId, redirectId, userId: req.user.id }
    });
    res.status(201).json(alias);
  })
);

// POST /api/artists/tag
router.post(
  '/tag',
  requireAuth,
  validate(artistTagSchema),
  authHandler(async (req, res) => {
    const { artistId, tagId } = parsedBody<ArtistTagInput>(res);
    const tag = await prisma.artistTag.upsert({
      where: { artistId_tagId: { artistId, tagId } },
      create: { artistId, tagId, userId: req.user.id },
      update: { positiveVotes: { increment: 1 } }
    });
    res.json(tag);
  })
);

// POST /api/artists
router.post(
  '/',
  requireAuth,
  validate(artistSchema),
  authHandler(async (req, res) => {
    const { name, vanityHouse } = parsedBody<ArtistInput>(res);

    const artist = await prisma.artist.create({
      data: { name, vanityHouse: vanityHouse ?? false }
    });

    await createArtistHistoryEntry({
      artistId: artist.id,
      editedBy: req.user.id,
      snapshot: { name, vanityHouse }
    });

    res.status(201).json(artist);
  })
);

// GET /api/artists/:id
router.get(
  '/:id',
  requireAuth,
  validateParams(artistIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const artist = await prisma.artist.findUnique({
      where: { id },
      include: {
        aliases: {
          include: { redirect: { select: { id: true, name: true } } }
        },
        tags: { include: { tag: true } },
        similarTo: {
          include: { similarArtist: { select: { id: true, name: true } } }
        },
        releases: { orderBy: { year: 'desc' }, take: 20 }
      }
    });
    if (!artist) return res.status(404).json({ msg: 'Artist not found' });
    res.json(artist);
  })
);

// GET /api/artists/:id/similar
router.get(
  '/:id/similar',
  requireAuth,
  validateParams(artistIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id: artistId } = parsedParams<{ id: number }>(res);
    const similar = await prisma.similarArtist.findMany({
      where: { artistId },
      include: { similarArtist: { select: { id: true, name: true } } },
      orderBy: { score: 'desc' }
    });
    res.json(similar);
  })
);

// PUT /api/artists/:id
router.put(
  '/:id',
  requireAuth,
  validateParams(artistIdParamsSchema),
  validate(updateArtistSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { name, vanityHouse, description } =
      parsedBody<UpdateArtistInput>(res);

    const existing = await prisma.artist.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Artist not found' });

    const artist = await prisma.$transaction(async (tx) => {
      const updatedArtist = await tx.artist.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(vanityHouse !== undefined && { vanityHouse })
        }
      });

      await createArtistHistoryEntry({
        db: tx,
        artistId: id,
        editedBy: req.user.id,
        snapshot: { name, vanityHouse },
        description
      });

      return updatedArtist;
    });

    res.json(artist);
  })
);

// DELETE /api/artists/:id
router.delete(
  '/:id',
  requireAuth,
  validateParams(artistIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const artist = await prisma.artist.findUnique({ where: { id } });
    if (!artist) return res.status(404).json({ msg: 'Artist not found' });
    await prisma.artist.delete({ where: { id } });
    res.json({ msg: 'Artist deleted' });
  })
);

export default router;
