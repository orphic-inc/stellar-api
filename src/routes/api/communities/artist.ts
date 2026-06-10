import express, { Request, Response } from 'express';
import { z } from 'zod';
import { RegistrationStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import {
  createArtist,
  updateArtist,
  revertArtistFromHistory
} from '../../../modules/artist';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import {
  parsedBody,
  validate,
  validateParams,
  validateQuery,
  parsedParams
} from '../../../middleware/validate';
import {
  parsedPage,
  paginatedResponse,
  paginationBase
} from '../../../lib/pagination';
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
const artistsQuerySchema = z.object({ ...paginationBase });

// GET /api/artists
router.get(
  '/',
  requireAuth,
  validateQuery(artistsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsedPage(res);
    const [artists, total] = await Promise.all([
      prisma.artist.findMany({
        skip: pg.skip,
        take: pg.limit,
        include: { _count: { select: { credits: true } } },
        orderBy: { name: 'asc' }
      }),
      prisma.artist.count()
    ]);
    paginatedResponse(res, artists, total, pg);
  })
);

// GET /api/artists/vanity-house — paginated list of vanity house artists (staff)
router.get(
  '/vanity-house',
  ...requirePermission('admin'),
  validateQuery(artistsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsedPage(res);
    const [artists, total] = await Promise.all([
      prisma.artist.findMany({
        where: { vanityHouse: true },
        skip: pg.skip,
        take: pg.limit,
        include: { _count: { select: { credits: true } } },
        orderBy: { name: 'asc' }
      }),
      prisma.artist.count({ where: { vanityHouse: true } })
    ]);
    paginatedResponse(res, artists, total, pg);
  })
);

const vanityHouseBodySchema = z.object({ vanityHouse: z.boolean() });

// PUT /api/artists/:id/vanity-house — toggle vanity house status (news_manage)
router.put(
  '/:id/vanity-house',
  ...requirePermission('news_manage'),
  validateParams(artistIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const parsed = vanityHouseBodySchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ msg: 'vanityHouse (boolean) required' });
    const artist = await prisma.artist.findUnique({ where: { id } });
    if (!artist) return res.status(404).json({ msg: 'Artist not found' });
    const updated = await prisma.artist.update({
      where: { id },
      data: { vanityHouse: parsed.data.vanityHouse },
      include: { _count: { select: { credits: true } } }
    });
    res.json(updated);
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
    const artist = await createArtist(name, vanityHouse ?? false, req.user.id);
    res.status(201).json(artist);
  })
);

// GET /api/artists/:id/subscribe
router.get(
  '/:id/subscribe',
  requireAuth,
  validateParams(artistIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const sub = await prisma.artistSubscription.findUnique({
      where: { userId_artistId: { userId: req.user.id, artistId: id } }
    });
    res.json({ subscribed: sub !== null });
  })
);

// POST /api/artists/:id/subscribe
router.post(
  '/:id/subscribe',
  requireAuth,
  validateParams(artistIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const artist = await prisma.artist.findUnique({ where: { id } });
    if (!artist) return res.status(404).json({ msg: 'Artist not found' });
    await prisma.artistSubscription.upsert({
      where: { userId_artistId: { userId: req.user.id, artistId: id } },
      create: { userId: req.user.id, artistId: id },
      update: {}
    });
    res.json({ subscribed: true });
  })
);

// DELETE /api/artists/:id/subscribe
router.delete(
  '/:id/subscribe',
  requireAuth,
  validateParams(artistIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    await prisma.artistSubscription.deleteMany({
      where: { userId: req.user.id, artistId: id }
    });
    res.json({ subscribed: false });
  })
);

// GET /api/artists/:id
router.get(
  '/:id',
  requireAuth,
  validateParams(artistIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);

    // Determine communities the requesting user can access
    const [consumer, contributor, openCommunities] = await Promise.all([
      prisma.consumer.findUnique({
        where: { userId: req.user.id },
        select: { communities: { select: { id: true } } }
      }),
      prisma.contributor.findUnique({
        where: { userId: req.user.id },
        select: { communityId: true }
      }),
      prisma.community.findMany({
        where: { registrationStatus: RegistrationStatus.open },
        select: { id: true }
      })
    ]);

    const accessibleIds = [
      ...(consumer?.communities.map((c) => c.id) ?? []),
      ...(contributor ? [contributor.communityId] : []),
      ...openCommunities.map((c) => c.id)
    ];
    const accessibleCommunityIds = [...new Set(accessibleIds)];

    const [artist, subscription] = await Promise.all([
      prisma.artist.findUnique({
        where: { id },
        include: {
          aliases: {
            include: { redirect: { select: { id: true, name: true } } }
          },
          tags: { include: { tag: true } },
          similarTo: {
            include: { similarArtist: { select: { id: true, name: true } } }
          },
          credits: {
            where: {
              release: { communityId: { in: accessibleCommunityIds } }
            },
            include: {
              release: {
                include: { community: { select: { id: true, name: true } } }
              }
            },
            orderBy: [
              { release: { year: 'desc' } },
              { release: { title: 'asc' } }
            ]
          }
        }
      }),
      prisma.artistSubscription.findUnique({
        where: { userId_artistId: { userId: req.user.id, artistId: id } }
      })
    ]);
    if (!artist) return res.status(404).json({ msg: 'Artist not found' });
    const { credits, ...artistRest } = artist;
    res.json({
      ...artistRest,
      releases: credits.map((credit) => ({
        ...credit.release,
        role: credit.role
      })),
      isSubscribed: subscription !== null
    });
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

    const artist = await updateArtist(id, req.user.id, {
      name,
      vanityHouse,
      description
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
    res.status(204).send();
  })
);

export default router;
