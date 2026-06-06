import express from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { validateParams, parsedParams } from '../../middleware/validate';
import {
  releaseCreditsSelect,
  withPrimaryArtist
} from '../../modules/releaseCredits';

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
    const bookmarks = await prisma.bookmarkArtist.findMany({
      where: { userId: req.user.id },
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
      await prisma.bookmarkArtist.delete({
        where: { userId_artistId: { userId: req.user.id, artistId } }
      });
      return res.json({ bookmarked: false });
    }
    await prisma.bookmarkArtist.create({
      data: { userId: req.user.id, artistId }
    });
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
      await prisma.bookmarkRelease.delete({
        where: { userId_releaseId: { userId: req.user.id, releaseId } }
      });
      return res.json({ bookmarked: false });
    }
    await prisma.bookmarkRelease.create({
      data: { userId: req.user.id, releaseId }
    });
    res.json({ bookmarked: true });
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
      await prisma.bookmarkCommunity.delete({
        where: { userId_communityId: { userId: req.user.id, communityId } }
      });
      return res.json({ bookmarked: false });
    }
    await prisma.bookmarkCommunity.create({
      data: { userId: req.user.id, communityId }
    });
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
    const bookmarks = await prisma.bookmarkRequest.findMany({
      where: { userId: req.user.id },
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
      await prisma.bookmarkRequest.delete({
        where: { userId_requestId: { userId: req.user.id, requestId } }
      });
      return res.json({ bookmarked: false });
    }
    await prisma.bookmarkRequest.create({
      data: { userId: req.user.id, requestId }
    });
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
