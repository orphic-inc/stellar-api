import express, { Request, Response } from 'express';
import { z } from 'zod';
import { RegistrationStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { translatePrismaError } from '../../../lib/prismaErrors';
import { audit } from '../../../lib/audit';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { communityRoleUnion } from '../../../modules/communityAccess';
import {
  createArtist,
  updateArtist,
  revertArtistFromHistory,
  assertArtistLive
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
  vanityHouseSchema,
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
        where: { deletedAt: null },
        skip: pg.skip,
        take: pg.limit,
        include: { _count: { select: { credits: true } } },
        orderBy: { name: 'asc' }
      }),
      prisma.artist.count({ where: { deletedAt: null } })
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
        where: { vanityHouse: true, deletedAt: null },
        skip: pg.skip,
        take: pg.limit,
        include: { _count: { select: { credits: true } } },
        orderBy: { name: 'asc' }
      }),
      prisma.artist.count({ where: { vanityHouse: true, deletedAt: null } })
    ]);
    paginatedResponse(res, artists, total, pg);
  })
);

// PUT /api/artists/:id/vanity-house — toggle vanity house status (news_manage)
router.put(
  '/:id/vanity-house',
  ...requirePermission('news_manage'),
  validateParams(artistIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const parsed = vanityHouseSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ msg: 'vanityHouse (boolean) required' });
    const artist = await prisma.artist.findUnique({
      where: { id, deletedAt: null }
    });
    if (!artist) return res.status(404).json({ msg: 'Artist not found' });
    let updated;
    try {
      updated = await prisma.artist.update({
        where: { id },
        data: { vanityHouse: parsed.data.vanityHouse },
        include: { _count: { select: { credits: true } } }
      });
    } catch (err) {
      // The findUnique above answers the ordinary case; this closes the window
      // between it and the write, where P2025 would otherwise 500 (#564).
      translatePrismaError(err, { P2025: [404, 'Artist not found'] });
    }
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
    // Each history row's `data` snapshot carries the artist's name, so a
    // withdrawn artist is readable by name through this route (#573). It used
    // to answer an empty 200 for a missing id as well; both now 404.
    await assertArtistLive(artistId);
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
    // A soft-deleted artist keeps a live row, so the foreign key below is
    // satisfied and this would record a similarity the read then filters out
    // (#573) — a write reporting success with no possible effect. Same status
    // and wording as the P2003 arm: both mean "a body id names no usable
    // artist", and they must not diverge on which kind of unusable it was.
    const bodyIdMissing: [number, string] = [
      400,
      'Artist or similar artist not found'
    ];
    await assertArtistLive(artistId, bodyIdMissing);
    await assertArtistLive(similarArtistId, bodyIdMissing);
    let result;
    try {
      result = await prisma.similarArtist.upsert({
        where: { artistId_similarArtistId: { artistId, similarArtistId } },
        create: { artistId, similarArtistId, votes: [] },
        update: {}
      });
    } catch (err) {
      translatePrismaError(err, {
        P2003: [400, 'Artist or similar artist not found'],
        P2002: [409, 'That similarity is already recorded']
      });
    }
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
    // As on /similar: a withdrawn artist satisfies the foreign key, so without
    // this the alias is created and then filtered out of every read (#573).
    const bodyIdMissing: [number, string] = [
      400,
      'Artist or redirect target not found'
    ];
    await assertArtistLive(artistId, bodyIdMissing);
    await assertArtistLive(redirectId, bodyIdMissing);
    let alias;
    try {
      alias = await prisma.artistAlias.create({
        data: { artistId, redirectId, userId: req.user.id }
      });
    } catch (err) {
      // Two body-supplied foreign keys, and P2003 names neither, so the message
      // covers both. `userId` is session-derived and cannot dangle (#564).
      translatePrismaError(err, {
        P2003: [400, 'Artist or redirect target not found']
      });
    }
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
    let tag;
    try {
      tag = await prisma.artistTag.upsert({
        where: { artistId_tagId: { artistId, tagId } },
        create: { artistId, tagId, userId: req.user.id },
        update: { positiveVotes: { increment: 1 } }
      });
    } catch (err) {
      translatePrismaError(err, {
        P2003: [400, 'Artist or tag not found'],
        P2002: [409, 'Tag vote already being recorded, retry']
      });
    }
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
    // POST on this same path already 404s for a missing or withdrawn artist.
    // GET and DELETE answered an unconditional 200, so one resource had two
    // answers depending on the verb (#573, closing the #575 /artists split).
    await assertArtistLive(id);
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
    await assertArtistLive(id);
    try {
      await prisma.artistSubscription.upsert({
        where: { userId_artistId: { userId: req.user.id, artistId: id } },
        create: { userId: req.user.id, artistId: id },
        update: {}
      });
    } catch (err) {
      // `userId` is session-derived; only the PATH id can dangle, so 404 (#564).
      translatePrismaError(err, { P2003: [404, 'Artist not found'] });
    }
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
    // Gates on the ARTIST, not on the subscription: unsubscribing stays
    // idempotent, so a live artist you were never subscribed to still answers
    // 200 `{ subscribed: false }` rather than 404.
    await assertArtistLive(id);
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

    // Communities the requesting user can access — the same union the gates
    // use (#419), so credits from a community they staff are no longer hidden.
    const accessible = await prisma.community.findMany({
      where: {
        OR: [
          { registrationStatus: RegistrationStatus.open },
          communityRoleUnion(req.user.id)
        ]
      },
      select: { id: true }
    });
    const accessibleCommunityIds = accessible.map((c) => c.id);

    const [artist, subscription] = await Promise.all([
      prisma.artist.findUnique({
        where: { id, deletedAt: null },
        include: {
          // Both relations name another ARTIST, so both need the invariant
          // applied to the target as well as to the row above (#573). The
          // filter drops the join row rather than nulling its target: an alias
          // pointing at a withdrawn artist, or a similarity to one, is not a
          // fact worth rendering. `tags` is unaffected — a Tag, not an Artist.
          aliases: {
            where: { redirect: { deletedAt: null } },
            include: { redirect: { select: { id: true, name: true } } }
          },
          tags: { include: { tag: true } },
          similarTo: {
            where: { similarArtist: { deletedAt: null } },
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
    // Both directions leaked (#573). The parent was never checked at all, so a
    // withdrawn artist's own similar list stayed readable; and the target was
    // unfiltered, so a withdrawn artist appeared in a live one's list.
    // Filtering the target alone fixes only the second.
    await assertArtistLive(artistId);
    const similar = await prisma.similarArtist.findMany({
      where: { artistId, similarArtist: { deletedAt: null } },
      include: { similarArtist: { select: { id: true, name: true } } },
      orderBy: { score: 'desc' }
    });
    res.json(similar);
  })
);

// PUT /api/artists/:id
// PUT /api/artists/:id — requires communities_manage
//
// An artist row is a shared catalogue entry with no ownership concept, so
// `requireAuth` alone authorized nothing (#509 F3). It also accepts
// `vanityHouse`, which `PUT /:id/vanity-house` above gates behind
// `news_manage` — so the gate on that route was reachable around, through this
// one. `communities_manage` matches `POST /revert/:historyId`, which undoes
// exactly the edit this route makes; gating the undo more tightly than the do
// was the inconsistency.
router.put(
  '/:id',
  ...requirePermission('communities_manage'),
  validateParams(artistIdParamsSchema),
  validate(updateArtistSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { name, vanityHouse, description } =
      parsedBody<UpdateArtistInput>(res);

    const existing = await prisma.artist.findUnique({
      where: { id, deletedAt: null }
    });
    if (!existing) return res.status(404).json({ msg: 'Artist not found' });

    const artist = await updateArtist(id, req.user.id, {
      name,
      vanityHouse,
      description
    });
    res.json(artist);
  })
);

// DELETE /api/artists/:id — requires admin; soft delete
//
// Withdrawing a shared catalogue entry is the most destructive act available
// on an artist and it is not reversible through any route, so it sits at
// `admin` rather than alongside the edit gate.
//
// The delete is a soft one, and that is a correctness fix as much as a policy
// one: every relation that matters is `ON DELETE RESTRICT` and `createArtist`
// writes an artist_histories row at creation, so `prisma.artist.delete()`
// could only ever raise a foreign-key error the global handler renders as a
// 500. It could not have succeeded on any artist created through the API.
router.delete(
  '/:id',
  ...requirePermission('admin'),
  validateParams(artistIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const artist = await prisma.artist.findUnique({
      where: { id, deletedAt: null }
    });
    if (!artist) return res.status(404).json({ msg: 'Artist not found' });

    try {
      await prisma.artist.update({
        where: { id },
        data: { deletedAt: new Date() }
      });
    } catch (err) {
      translatePrismaError(err, { P2025: [404, 'Artist not found'] });
    }
    await audit(prisma, req.user.id, 'artist.delete', 'Artist', id, {
      name: artist.name
    });
    res.status(204).send();
  })
);

export default router;
