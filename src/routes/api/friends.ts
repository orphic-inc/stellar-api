import express from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { sanitizePlain } from '../../lib/sanitize';
import {
  parsedPage,
  paginatedResponse,
  paginationBase
} from '../../lib/pagination';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import {
  validate,
  validateParams,
  validateQuery,
  parsedBody,
  parsedParams
} from '../../middleware/validate';

const router = express.Router();

const friendsQuerySchema = z.object({ ...paginationBase });

const userIdParams = z.object({
  userId: z.coerce.number().int().positive()
});

const commentSchema = z.object({
  comment: z.string().max(500)
});

// GET /status/:userId before /:userId/* to avoid shadowing
router.get(
  '/status/:userId',
  requireAuth,
  validateParams(userIdParams),
  authHandler(async (req, res) => {
    const { userId: friendId } = parsedParams<{ userId: number }>(res);
    const existing = await prisma.friend.findUnique({
      where: { userId_friendId: { userId: req.user.id, friendId } }
    });
    res.json({ isFriend: existing !== null });
  })
);

router.get(
  '/',
  requireAuth,
  validateQuery(friendsQuerySchema),
  authHandler(async (req, res) => {
    const pg = parsedPage(res);
    const [friends, total] = await Promise.all([
      prisma.friend.findMany({
        where: { userId: req.user.id },
        include: {
          friend: { select: { id: true, username: true, avatar: true } }
        },
        orderBy: { friend: { username: 'asc' } },
        skip: pg.skip,
        take: pg.limit
      }),
      prisma.friend.count({ where: { userId: req.user.id } })
    ]);
    paginatedResponse(res, friends, total, pg);
  })
);

router.post(
  '/:userId',
  requireAuth,
  validateParams(userIdParams),
  authHandler(async (req, res) => {
    const { userId: friendId } = parsedParams<{ userId: number }>(res);

    if (friendId === req.user.id) {
      throw new AppError(400, 'Cannot add yourself as a friend');
    }

    const target = await prisma.user.findUnique({
      where: { id: friendId },
      select: { id: true, disabled: true }
    });

    if (!target || target.disabled) {
      throw new AppError(404, 'User not found');
    }

    try {
      await prisma.friend.create({ data: { userId: req.user.id, friendId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') throw new AppError(409, 'Already friends');
        if (err.code === 'P2003') throw new AppError(404, 'User not found');
      }
      throw err;
    }

    res.status(201).json({});
  })
);

router.delete(
  '/:userId',
  requireAuth,
  validateParams(userIdParams),
  authHandler(async (req, res) => {
    const { userId: friendId } = parsedParams<{ userId: number }>(res);
    await prisma.friend.deleteMany({
      where: { userId: req.user.id, friendId }
    });
    res.status(204).send();
  })
);

router.put(
  '/:userId/comment',
  requireAuth,
  validateParams(userIdParams),
  validate(commentSchema),
  authHandler(async (req, res) => {
    const { userId: friendId } = parsedParams<{ userId: number }>(res);
    const { comment } = parsedBody<{ comment: string }>(res);

    const result = await prisma.friend.updateMany({
      where: { userId: req.user.id, friendId },
      data: { comment: sanitizePlain(comment) }
    });

    if (result.count === 0) {
      throw new AppError(404, 'Friend not found');
    }

    res.json({});
  })
);

export default router;
