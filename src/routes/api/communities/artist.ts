import express, { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma';
import { asyncHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import {
  artistSchema,
  similarArtistSchema,
  artistAliasSchema,
  artistTagSchema
} from '../../../schemas/artist';

const router = express.Router();

// GET /api/artists
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const artists = await prisma.artist.findMany({
      include: { _count: { select: { releases: true } } }
    });
    res.json(artists);
  })
);

// GET /api/artists/:id
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
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

// POST /api/artists
router.post(
  '/',
  requireAuth,
  validate(artistSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, vanityHouse } = req.body as {
      name: string;
      vanityHouse?: boolean;
    };

    const artist = await prisma.artist.create({
      data: { name, vanityHouse: vanityHouse ?? false }
    });

    await prisma.artistHistory.create({
      data: {
        artistId: artist.id,
        editedBy: req.user!.id,
        data: { name, vanityHouse }
      }
    });

    res.status(201).json(artist);
  })
);

// PUT /api/artists/:id
router.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const existing = await prisma.artist.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Artist not found' });

    const { name, vanityHouse } = req.body;

    const [artist] = await prisma.$transaction([
      prisma.artist.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(vanityHouse !== undefined && { vanityHouse })
        }
      }),
      prisma.artistHistory.create({
        data: {
          artistId: id,
          editedBy: req.user!.id,
          data: req.body,
          description: req.body.description
        }
      })
    ]);

    res.json(artist);
  })
);

// GET /api/artists/history/:artistId
router.get(
  '/history/:artistId',
  asyncHandler(async (req: Request, res: Response) => {
    const artistId = parseInt(req.params.artistId);
    if (isNaN(artistId)) return res.status(400).json({ msg: 'Invalid id' });
    const history = await prisma.artistHistory.findMany({
      where: { artistId },
      orderBy: { editedAt: 'desc' },
      include: { editedUser: { select: { id: true, username: true } } }
    });
    res.json(history);
  })
);

// POST /api/artists/revert/:historyId
router.post(
  '/revert/:historyId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const historyId = parseInt(req.params.historyId);
    if (isNaN(historyId)) return res.status(400).json({ msg: 'Invalid id' });
    const entry = await prisma.artistHistory.findUnique({
      where: { id: historyId }
    });
    if (!entry) return res.status(404).json({ msg: 'History entry not found' });

    const data = entry.data as Record<string, unknown>;
    const artist = await prisma.artist.update({
      where: { id: entry.artistId },
      data: {
        ...(data.name !== undefined && { name: data.name as string }),
        ...(data.vanityHouse !== undefined && {
          vanityHouse: data.vanityHouse as boolean
        })
      }
    });

    await prisma.artistHistory.create({
      data: {
        artistId: artist.id,
        editedBy: req.user!.id,
        data: { name: artist.name, vanityHouse: artist.vanityHouse },
        description: `Reverted to history #${historyId}`
      }
    });

    res.json({ msg: 'Artist reverted successfully', artist });
  })
);

// GET /api/artists/:id/similar
router.get(
  '/:id/similar',
  asyncHandler(async (req: Request, res: Response) => {
    const artistId = parseInt(req.params.id);
    if (isNaN(artistId)) return res.status(400).json({ msg: 'Invalid id' });
    const similar = await prisma.similarArtist.findMany({
      where: { artistId },
      include: { similarArtist: { select: { id: true, name: true } } },
      orderBy: { score: 'desc' }
    });
    res.json(similar);
  })
);

// POST /api/artists/similar
router.post(
  '/similar',
  requireAuth,
  validate(similarArtistSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { artistId, similarArtistId } = req.body as {
      artistId: number;
      similarArtistId: number;
    };
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
  asyncHandler(async (req: Request, res: Response) => {
    const { artistId, redirectId } = req.body as {
      artistId: number;
      redirectId: number;
    };
    const alias = await prisma.artistAlias.create({
      data: { artistId, redirectId, userId: req.user!.id }
    });
    res.status(201).json(alias);
  })
);

// POST /api/artists/tag
router.post(
  '/tag',
  requireAuth,
  validate(artistTagSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { artistId, tagId } = req.body as { artistId: number; tagId: number };
    const tag = await prisma.artistTag.upsert({
      where: { artistId_tagId: { artistId, tagId } },
      create: { artistId, tagId, userId: req.user!.id },
      update: { positiveVotes: { increment: 1 } }
    });
    res.json(tag);
  })
);

// DELETE /api/artists/:id
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const artist = await prisma.artist.findUnique({ where: { id } });
    if (!artist) return res.status(404).json({ msg: 'Artist not found' });
    await prisma.artist.delete({ where: { id } });
    res.json({ msg: 'Artist deleted' });
  })
);

export default router;
