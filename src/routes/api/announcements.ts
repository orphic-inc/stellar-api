import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requirePermission } from '../../middleware/permissions';
import { validate, validateParams } from '../../middleware/validate';
import { announcementSchema } from '../../schemas/announcement';
import { sanitizePlain } from '../../lib/sanitize';

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

// POST /api/announcements — create news item (staff)
router.post(
  '/',
  ...requirePermission('news_manage'),
  validate(announcementSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { title, body } = req.body as { title: string; body: string };
    const news = await prisma.news.create({
      data: { title: sanitizePlain(title), body: sanitizePlain(body) }
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
    const { id } = req.params as unknown as { id: number };
    const { title, body } = req.body as { title: string; body: string };
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
    const { id } = req.params as unknown as { id: number };
    await prisma.news.delete({ where: { id } });
    res.json({ msg: 'Deleted' });
  })
);

// POST /api/announcements/blog — create blog post (staff)
router.post(
  '/blog',
  ...requirePermission('news_manage'),
  validate(announcementSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { title, body } = req.body as { title: string; body: string };
    const post = await prisma.blog.create({
      data: {
        title: sanitizePlain(title),
        body: sanitizePlain(body),
        userId: req.user!.id
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
    const { id } = req.params as unknown as { id: number };
    await prisma.blog.delete({ where: { id } });
    res.json({ msg: 'Deleted' });
  })
);

export default router;
