import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
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
import { sanitizePlain } from '../../lib/sanitize';
import { emitNotifications } from '../../lib/notifications';

const router = express.Router();
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/announcements
router.get(
  '/',
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

// PUT /api/announcements/:id — update news item (staff)
router.put(
  '/:id',
  ...requirePermission('news_manage'),
  validateParams(idParamsSchema),
  validate(announcementSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { title, body } = parsedBody<AnnouncementInput>(res);
    const news = await prisma.news.update({
      where: { id },
      data: {
        ...(title && { title: sanitizePlain(title) }),
        ...(body && { body: sanitizePlain(body) })
      }
    });
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
    await prisma.news.delete({ where: { id } });
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
    await prisma.blog.delete({ where: { id } });
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
    await prisma.globalNotice.delete({ where: { id } });
    res.status(204).send();
  })
);

export default router;
