import express from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { validateParams, parsedParams } from '../../middleware/validate';
import {
  releaseCreditsSelect,
  withPrimaryArtist
} from '../../modules/releaseCredits';
import { removeConsumedReleaseBookmarks } from '../../modules/bookmark';

const router = express.Router();

const artistIdParams = z.object({
  artistId: z.coerce.number().int().positive()
});
const releaseIdParams = z.object({
  releaseId: z.coerce.number().int().positive()
});
const communityIdParams = z.object({
  communityId: z.coerce.number().int().positive()
});
const requestIdParams = z.object({
  requestId: z.coerce.number().int().positive()
});

// ─── Artist bookmarks ─────────────────────────────────────────────────────────

router.get(
  '/artists',
  requireAuth,
  authHandler(async (req, res) => {
    // A bookmark list IS an artist list, which `Artist.deletedAt` says filters
    // withdrawn artists out (#573). Unfiltered, this handed the member a name
    // whose own detail route answers 404 — a dead entry in their own list.
    const bookmarks = await prisma.bookmarkArtist.findMany({
      where: { userId: req.user.id, artist: { deletedAt: null } },
      include: { artist: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(bookmarks);
  })
);

router.post(
  '/artists/:artistId',
  requireAuth,
  validateParams(artistIdParams),
  authHandler(async (req, res) => {
    const { artistId } = parsedParams<{ artistId: number }>(res);
    const existing = await prisma.bookmarkArtist.findUnique({
      where: { userId_artistId: { userId: req.user.id, artistId } }
    });
    if (existing) {
      // deleteMany, not delete: a concurrent un-bookmark between the read above
      // and this write makes `delete` throw P2025, which carries no statusCode
      // and so 500s. deleteMany no-ops on zero rows (#564, arm B).
      await prisma.bookmarkArtist.deleteMany({
        where: { userId: req.user.id, artistId }
      });
      return res.json({ bookmarked: false });
    }
    try {
      await prisma.bookmarkArtist.create({
        data: { userId: req.user.id, artistId }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        // The path id names nothing. A foreign-key violation here is a CLIENT
        // mistake, and answering 500 both misreports it and logs it as an
        // unhandled error (#564, arm A).
        if (err.code === 'P2003') throw new AppError(404, 'Artist not found');
        // A concurrent POST created the row first. Its intent was to bookmark
        // and the bookmark now exists, so report the resulting state rather
        // than a conflict — this endpoint answers "what is the state now?".
        if (err.code === 'P2002') return res.json({ bookmarked: true });
      }
      throw err;
    }
    res.json({ bookmarked: true });
  })
);

router.delete(
  '/artists/:artistId',
  requireAuth,
  validateParams(artistIdParams),
  authHandler(async (req, res) => {
    const { artistId } = parsedParams<{ artistId: number }>(res);
    await prisma.bookmarkArtist.deleteMany({
      where: { userId: req.user.id, artistId }
    });
    res.status(204).send();
  })
);

// ─── Release bookmarks ────────────────────────────────────────────────────────

router.get(
  '/releases',
  requireAuth,
  authHandler(async (req, res) => {
    const bookmarks = await prisma.bookmarkRelease.findMany({
      where: { userId: req.user.id },
      include: {
        release: {
          select: {
            id: true,
            communityId: true,
            title: true,
            credits: releaseCreditsSelect
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(
      bookmarks.map((bookmark) => ({
        ...bookmark,
        release: withPrimaryArtist(bookmark.release)
      }))
    );
  })
);

router.post(
  '/releases/:releaseId',
  requireAuth,
  validateParams(releaseIdParams),
  authHandler(async (req, res) => {
    const { releaseId } = parsedParams<{ releaseId: number }>(res);
    const existing = await prisma.bookmarkRelease.findUnique({
      where: { userId_releaseId: { userId: req.user.id, releaseId } }
    });
    if (existing) {
      // deleteMany, not delete: a concurrent un-bookmark between the read above
      // and this write makes `delete` throw P2025, which carries no statusCode
      // and so 500s. deleteMany no-ops on zero rows (#564, arm B).
      await prisma.bookmarkRelease.deleteMany({
        where: { userId: req.user.id, releaseId }
      });
      return res.json({ bookmarked: false });
    }
    try {
      await prisma.bookmarkRelease.create({
        data: { userId: req.user.id, releaseId }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        // The path id names nothing. A foreign-key violation here is a CLIENT
        // mistake, and answering 500 both misreports it and logs it as an
        // unhandled error (#564, arm A).
        if (err.code === 'P2003') throw new AppError(404, 'Release not found');
        // A concurrent POST created the row first. Its intent was to bookmark
        // and the bookmark now exists, so report the resulting state rather
        // than a conflict — this endpoint answers "what is the state now?".
        if (err.code === 'P2002') return res.json({ bookmarked: true });
      }
      throw err;
    }
    res.json({ bookmarked: true });
  })
);

// Static segment must precede '/releases/:releaseId' or Express shadows it and
// validateParams 400s on "consumed".
router.delete(
  '/releases/consumed',
  requireAuth,
  authHandler(async (req, res) => {
    const removed = await removeConsumedReleaseBookmarks(req.user.id);
    res.json({ removed });
  })
);

router.delete(
  '/releases/:releaseId',
  requireAuth,
  validateParams(releaseIdParams),
  authHandler(async (req, res) => {
    const { releaseId } = parsedParams<{ releaseId: number }>(res);
    await prisma.bookmarkRelease.deleteMany({
      where: { userId: req.user.id, releaseId }
    });
    res.status(204).send();
  })
);

// ─── Community bookmarks ──────────────────────────────────────────────────────

router.get(
  '/communities',
  requireAuth,
  authHandler(async (req, res) => {
    const bookmarks = await prisma.bookmarkCommunity.findMany({
      where: { userId: req.user.id },
      include: { community: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(bookmarks);
  })
);

router.post(
  '/communities/:communityId',
  requireAuth,
  validateParams(communityIdParams),
  authHandler(async (req, res) => {
    const { communityId } = parsedParams<{ communityId: number }>(res);
    const existing = await prisma.bookmarkCommunity.findUnique({
      where: { userId_communityId: { userId: req.user.id, communityId } }
    });
    if (existing) {
      // deleteMany, not delete: a concurrent un-bookmark between the read above
      // and this write makes `delete` throw P2025, which carries no statusCode
      // and so 500s. deleteMany no-ops on zero rows (#564, arm B).
      await prisma.bookmarkCommunity.deleteMany({
        where: { userId: req.user.id, communityId }
      });
      return res.json({ bookmarked: false });
    }
    try {
      await prisma.bookmarkCommunity.create({
        data: { userId: req.user.id, communityId }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        // The path id names nothing. A foreign-key violation here is a CLIENT
        // mistake, and answering 500 both misreports it and logs it as an
        // unhandled error (#564, arm A).
        if (err.code === 'P2003')
          throw new AppError(404, 'Community not found');
        // A concurrent POST created the row first. Its intent was to bookmark
        // and the bookmark now exists, so report the resulting state rather
        // than a conflict — this endpoint answers "what is the state now?".
        if (err.code === 'P2002') return res.json({ bookmarked: true });
      }
      throw err;
    }
    res.json({ bookmarked: true });
  })
);

router.delete(
  '/communities/:communityId',
  requireAuth,
  validateParams(communityIdParams),
  authHandler(async (req, res) => {
    const { communityId } = parsedParams<{ communityId: number }>(res);
    await prisma.bookmarkCommunity.deleteMany({
      where: { userId: req.user.id, communityId }
    });
    res.status(204).send();
  })
);

// ─── Request bookmarks ────────────────────────────────────────────────────────

router.get(
  '/requests',
  requireAuth,
  authHandler(async (req, res) => {
    // As with the artist list above (#573): a bookmark list is a list of the
    // thing bookmarked, and every request detail read filters `deletedAt`
    // (modules/requestLifecycle.ts), so this returned a title whose own route
    // answers 404 (#598).
    const bookmarks = await prisma.bookmarkRequest.findMany({
      where: { userId: req.user.id, request: { deletedAt: null } },
      include: { request: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(bookmarks);
  })
);

router.post(
  '/requests/:requestId',
  requireAuth,
  validateParams(requestIdParams),
  authHandler(async (req, res) => {
    const { requestId } = parsedParams<{ requestId: number }>(res);
    const existing = await prisma.bookmarkRequest.findUnique({
      where: { userId_requestId: { userId: req.user.id, requestId } }
    });
    if (existing) {
      // deleteMany, not delete: a concurrent un-bookmark between the read above
      // and this write makes `delete` throw P2025, which carries no statusCode
      // and so 500s. deleteMany no-ops on zero rows (#564, arm B).
      await prisma.bookmarkRequest.deleteMany({
        where: { userId: req.user.id, requestId }
      });
      return res.json({ bookmarked: false });
    }
    try {
      await prisma.bookmarkRequest.create({
        data: { userId: req.user.id, requestId }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        // The path id names nothing. A foreign-key violation here is a CLIENT
        // mistake, and answering 500 both misreports it and logs it as an
        // unhandled error (#564, arm A).
        if (err.code === 'P2003') throw new AppError(404, 'Request not found');
        // A concurrent POST created the row first. Its intent was to bookmark
        // and the bookmark now exists, so report the resulting state rather
        // than a conflict — this endpoint answers "what is the state now?".
        if (err.code === 'P2002') return res.json({ bookmarked: true });
      }
      throw err;
    }
    res.json({ bookmarked: true });
  })
);

router.delete(
  '/requests/:requestId',
  requireAuth,
  validateParams(requestIdParams),
  authHandler(async (req, res) => {
    const { requestId } = parsedParams<{ requestId: number }>(res);
    await prisma.bookmarkRequest.deleteMany({
      where: { userId: req.user.id, requestId }
    });
    res.status(204).send();
  })
);

export default router;
