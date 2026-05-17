import express from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { validateParams } from '../../middleware/validate';

const router = express.Router();
const notificationIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

type NotificationSource = { title: string; forumId?: number } | null;

function groupIds(
  notifications: { page: string; pageId: number }[],
  page: string
) {
  return [
    ...new Set(
      notifications.filter((n) => n.page === page).map((n) => n.pageId)
    )
  ];
}

// GET /api/notifications/unread-count
router.get(
  '/unread-count',
  requireAuth,
  authHandler(async (req, res) => {
    const count = await prisma.notification.count({
      where: { userId: req.user.id, readAt: null }
    });
    res.json({ count });
  })
);

// POST /api/notifications/read-all
router.post(
  '/read-all',
  requireAuth,
  authHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, readAt: null },
      data: { readAt: new Date() }
    });
    res.status(204).send();
  })
);

// GET /api/notifications
router.get(
  '/',
  requireAuth,
  authHandler(async (req, res) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        quoter: { select: { id: true, username: true, avatar: true } }
      }
    });

    const forumIds = groupIds(notifications, 'forums');
    const artistIds = groupIds(notifications, 'artist');
    const collageIds = groupIds(notifications, 'collages');
    const requestIds = groupIds(notifications, 'requests');
    const communityIds = groupIds(notifications, 'communities');

    const [topics, artists, collages, requests, communities] =
      await Promise.all([
        forumIds.length > 0
          ? prisma.forumTopic.findMany({
              where: { id: { in: forumIds } },
              select: { id: true, forumId: true, title: true }
            })
          : [],
        artistIds.length > 0
          ? prisma.artist.findMany({
              where: { id: { in: artistIds } },
              select: { id: true, name: true }
            })
          : [],
        collageIds.length > 0
          ? prisma.collage.findMany({
              where: { id: { in: collageIds } },
              select: { id: true, name: true }
            })
          : [],
        requestIds.length > 0
          ? prisma.request.findMany({
              where: { id: { in: requestIds } },
              select: { id: true, title: true }
            })
          : [],
        communityIds.length > 0
          ? prisma.community.findMany({
              where: { id: { in: communityIds } },
              select: { id: true, name: true }
            })
          : []
      ]);

    const topicMap = new Map(topics.map((t) => [t.id, t]));
    const artistMap = new Map(artists.map((a) => [a.id, a]));
    const collageMap = new Map(collages.map((c) => [c.id, c]));
    const requestMap = new Map(requests.map((r) => [r.id, r]));
    const communityMap = new Map(communities.map((c) => [c.id, c]));

    const enriched = notifications.map((n) => {
      let source: NotificationSource = null;
      if (n.page === 'forums') {
        const t = topicMap.get(n.pageId);
        source = t ? { title: t.title, forumId: t.forumId } : null;
      } else if (n.page === 'artist') {
        const a = artistMap.get(n.pageId);
        source = a ? { title: a.name } : null;
      } else if (n.page === 'collages') {
        const c = collageMap.get(n.pageId);
        source = c ? { title: c.name } : null;
      } else if (n.page === 'requests') {
        const r = requestMap.get(n.pageId);
        source = r ? { title: r.title } : null;
      } else if (n.page === 'communities') {
        const c = communityMap.get(n.pageId);
        source = c ? { title: c.name } : null;
      }
      return { ...n, source };
    });

    res.json(enriched);
  })
);

// POST /api/notifications/:id/read
router.post(
  '/:id/read',
  requireAuth,
  validateParams(notificationIdParamsSchema),
  authHandler(async (req, res) => {
    const id = Number(res.locals.parsedParams.id);
    const notif = await prisma.notification.findUnique({ where: { id } });
    if (!notif) return res.status(404).json({ msg: 'Notification not found' });
    if (notif.userId !== req.user.id)
      return res.status(403).json({ msg: 'Not authorized' });
    if (!notif.readAt) {
      await prisma.notification.update({
        where: { id },
        data: { readAt: new Date() }
      });
    }
    res.status(204).send();
  })
);

// DELETE /api/notifications/:id
router.delete(
  '/:id',
  requireAuth,
  validateParams(notificationIdParamsSchema),
  authHandler(async (req, res) => {
    const id = Number(res.locals.parsedParams.id);
    const notif = await prisma.notification.findUnique({ where: { id } });
    if (!notif) return res.status(404).json({ msg: 'Notification not found' });
    if (notif.userId !== req.user.id)
      return res.status(403).json({ msg: 'Not authorized' });
    await prisma.notification.delete({ where: { id } });
    res.status(204).send();
  })
);

export default router;
