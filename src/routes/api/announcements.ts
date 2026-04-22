import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';

const router = express.Router();

// GET /api/announcements
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const [news, blogs] = await Promise.all([
      prisma.news.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
      prisma.blog.findMany({
        orderBy: { createdAt: 'desc' }, take: 20,
        include: { user: { select: { username: true, avatar: true } } }
      })
    ]);
    res.json({ status: 'success', data: { announcements: news, blogPosts: blogs } });
  })
);

export default router;
