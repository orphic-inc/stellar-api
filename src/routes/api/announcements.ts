import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { translatePrismaError } from '../../lib/prismaErrors';
import { AppError } from '../../lib/errors';
import { releaseInPublicCommunity } from '../../modules/communityAccess';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import {
  announcementSchema,
  globalNoticeSchema,
  type AnnouncementInput,
  type GlobalNoticeInput
} from '../../schemas/announcement';
import {
  featuredAlbumSchema,
  type FeaturedAlbumInput
} from '../../schemas/featuredAlbum';
import { sanitizePlain } from '../../lib/sanitize';
import { emitNotifications } from '../../lib/notifications';

const router = express.Router();
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/announcements
//
// Gated as of #547. News and blog posts are site content on a private site, and
// this served them with no session. Only `PrivateHomepage.tsx` consumes it —
// stellar-ui's public pages call `GET /install` and nothing else — so the gate
// costs nothing downstream.
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const [news, blogs] = await Promise.all([
      prisma.news.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
      prisma.blog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { user: { select: { username: true, avatar: true } } }
      })
    ]);
    res.json({ announcements: news, blogPosts: blogs });
  })
);

// POST /api/announcements — create news item (staff); notifies all active users
router.post(
  '/',
  ...requirePermission('news_manage'),
  validate(announcementSchema),
  authHandler(async (req: Request, res: Response) => {
    const { title, body } = parsedBody<AnnouncementInput>(res);
    const news = await prisma.$transaction(async (tx) => {
      const created = await tx.news.create({
        data: { title: sanitizePlain(title), body: sanitizePlain(body) }
      });
      const recipients = await tx.user.findMany({
        where: { disabled: false },
        select: { id: true }
      });
      await emitNotifications(tx, {
        userIds: recipients.map((u) => u.id),
        type: 'site_news',
        page: 'news',
        pageId: created.id
      });
      return created;
    });
    res.status(201).json(news);
  })
);

// GET /api/announcements/album-of-month — list all featured albums (staff)
router.get(
  '/album-of-month',
  ...requirePermission('news_manage'),
  asyncHandler(async (_req: Request, res: Response) => {
    const albums = await prisma.featuredAlbum.findMany({
      orderBy: { started: 'desc' }
    });
    res.json(albums);
  })
);

// POST /api/announcements/album-of-month — create featured album entry (staff)
router.post(
  '/album-of-month',
  ...requirePermission('news_manage'),
  validate(featuredAlbumSchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const { groupId, threadId, title, image, started, ended } =
      parsedBody<FeaturedAlbumInput>(res);

    // Staff curation is an act of publication (ADR-0036 §4). Featuring a
    // release makes its identity public, so the refusal belongs HERE, at the
    // moment a person chooses it — not as a read-time filter, which would empty
    // the homepage slot silently and leave nobody accountable for it.
    //
    // This also closes a pre-existing hole: `FeaturedAlbum.groupId` carries no
    // foreign key to Release, so a dangling feature was already possible and
    // GET /home/featured rendered null for it without explanation. 400 rather
    // than 404 — the route exists; the id in the BODY does not resolve.
    //
    // (`groupId` naming a Release rather than a ReleaseGroup is #603's rename
    // territory, left alone here deliberately.)
    const featurable = await prisma.release.findFirst({
      where: { id: groupId, ...releaseInPublicCommunity },
      select: { id: true }
    });
    if (!featurable) {
      throw new AppError(
        400,
        'No release with that id in a public community — a release in a private community cannot be featured'
      );
    }

    const album = await prisma.featuredAlbum.create({
      data: {
        groupId,
        threadId,
        title,
        image: image ?? '',
        started: new Date(started),
        ended: new Date(ended)
      }
    });
    res.status(201).json(album);
  })
);

const albumIdParamsSchema = z.object({
  albumId: z.coerce.number().int().positive()
});

// DELETE /api/announcements/album-of-month/:albumId — delete featured album (staff)
router.delete(
  '/album-of-month/:albumId',
  ...requirePermission('news_manage'),
  validateParams(albumIdParamsSchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const { albumId } = parsedParams<{ albumId: number }>(res);
    const existing = await prisma.featuredAlbum.findUnique({
      where: { id: albumId }
    });
    if (!existing)
      return res.status(404).json({ msg: 'Featured album not found' });
    try {
      await prisma.featuredAlbum.delete({ where: { id: albumId } });
    } catch (err) {
      // The findUnique above answers the common case with a clear message.
      // This closes the window between that read and this write: #564 treats a
      // prior read as insufficient on its own, because the row can go in
      // between and P2025 would then 500.
      translatePrismaError(err, { P2025: [404, 'Featured album not found'] });
    }
    res.status(204).send();
  })
);

// PUT /api/announcements/:id — update news item (staff)
router.put(
  '/:id',
  ...requirePermission('news_manage'),
  validateParams(idParamsSchema),
  validate(announcementSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { title, body } = parsedBody<AnnouncementInput>(res);
    let news;
    try {
      news = await prisma.news.update({
        where: { id },
        data: {
          ...(title && { title: sanitizePlain(title) }),
          ...(body && { body: sanitizePlain(body) })
        }
      });
    } catch (err) {
      // P2025: the row is gone. Prisma raises it for a missing row on ANY
      // model, and `News` carries neither a foreign key nor a unique
      // constraint — which is why the constraint-only reading of #564
      // classified this as safe. The contract has always declared this 404;
      // until now it could not fire.
      translatePrismaError(err, { P2025: [404, 'Announcement not found'] });
    }
    res.json(news);
  })
);

// DELETE /api/announcements/:id — delete news item (staff)
router.delete(
  '/:id',
  ...requirePermission('news_manage'),
  validateParams(idParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    try {
      await prisma.news.delete({ where: { id } });
    } catch (err) {
      // P2025: the row is gone. Prisma raises it for a missing row on ANY
      // model, and `News` carries neither a foreign key nor a unique
      // constraint — which is why the constraint-only reading of #564
      // classified this as safe. The contract has always declared this 404;
      // until now it could not fire.
      translatePrismaError(err, { P2025: [404, 'Announcement not found'] });
    }
    res.status(204).send();
  })
);

// POST /api/announcements/blog — create blog post (staff)
router.post(
  '/blog',
  ...requirePermission('news_manage'),
  validate(announcementSchema),
  authHandler(async (req, res) => {
    const { title, body } = parsedBody<AnnouncementInput>(res);
    const post = await prisma.blog.create({
      data: {
        title: sanitizePlain(title),
        body: sanitizePlain(body),
        userId: req.user.id
      },
      include: { user: { select: { id: true, username: true } } }
    });
    res.status(201).json(post);
  })
);

// DELETE /api/announcements/blog/:id — delete blog post (author or staff)
router.delete(
  '/blog/:id',
  ...requirePermission('news_manage'),
  validateParams(idParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    try {
      await prisma.blog.delete({ where: { id } });
    } catch (err) {
      // P2025 on a missing row (#564, arm B). `Blog` has no unique constraint
      // and its only foreign key is the author, so nothing else can raise here.
      translatePrismaError(err, { P2025: [404, 'Blog post not found'] });
    }
    res.status(204).send();
  })
);

// GET /api/announcements/global-notices — list all global notices (staff)
router.get(
  '/global-notices',
  ...requirePermission('news_manage'),
  asyncHandler(async (_req: Request, res: Response) => {
    const notices = await prisma.globalNotice.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, username: true } } }
    });
    res.json(notices);
  })
);

// POST /api/announcements/global-notice — broadcast a notice to all active users (staff)
router.post(
  '/global-notice',
  ...requirePermission('news_manage'),
  validate(globalNoticeSchema),
  authHandler(async (req, res) => {
    const { message, url, expiresAt } = parsedBody<GlobalNoticeInput>(res);
    const notice = await prisma.$transaction(async (tx) => {
      const created = await tx.globalNotice.create({
        data: {
          message: sanitizePlain(message),
          url: url ?? null,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          createdById: req.user.id
        }
      });
      const recipients = await tx.user.findMany({
        where: { disabled: false },
        select: { id: true }
      });
      await emitNotifications(tx, {
        userIds: recipients.map((u) => u.id),
        type: 'global_notice',
        actorId: req.user.id,
        page: 'global_notices',
        pageId: created.id
      });
      return created;
    });
    res.status(201).json(notice);
  })
);

// DELETE /api/announcements/global-notice/:id — remove a global notice (staff)
router.delete(
  '/global-notice/:id',
  ...requirePermission('news_manage'),
  validateParams(idParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    try {
      await prisma.globalNotice.delete({ where: { id } });
    } catch (err) {
      // P2025 on a missing row (#564, arm B).
      translatePrismaError(err, { P2025: [404, 'Global notice not found'] });
    }
    res.status(204).send();
  })
);

export default router;
