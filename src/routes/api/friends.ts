import express from 'express';
import { z } from 'zod';
import { Prisma, FriendStatus } from '@prisma/client';
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

const userSummary = { id: true, username: true, avatar: true } as const;

// Either-direction match for a relationship between the actor and `otherId`.
const betweenUsers = (actorId: number, otherId: number) => ({
  OR: [
    { requesterId: actorId, recipientId: otherId },
    { requesterId: otherId, recipientId: actorId }
  ]
});

// ─── GET /status/:userId ──────────────────────────────────────────────────────
// Static/specific segments registered before /:userId to avoid shadowing.
router.get(
  '/status/:userId',
  requireAuth,
  validateParams(userIdParams),
  authHandler(async (req, res) => {
    const { userId: otherId } = parsedParams<{ userId: number }>(res);
    const rel = await prisma.friendRelationship.findFirst({
      where: betweenUsers(req.user.id, otherId)
    });

    let status:
      | 'none'
      | 'pending_sent'
      | 'pending_received'
      | 'accepted'
      | 'rejected' = 'none';
    if (rel) {
      if (rel.status === FriendStatus.accepted) status = 'accepted';
      else if (rel.status === FriendStatus.rejected) status = 'rejected';
      else
        status =
          rel.requesterId === req.user.id ? 'pending_sent' : 'pending_received';
    }

    res.json({ status, isFriend: status === 'accepted' });
  })
);

// ─── GET /requests — incoming pending requests ────────────────────────────────
router.get(
  '/requests',
  requireAuth,
  validateQuery(friendsQuerySchema),
  authHandler(async (req, res) => {
    const pg = parsedPage(res);
    const where = {
      recipientId: req.user.id,
      status: FriendStatus.pending
    };
    const [rows, total] = await Promise.all([
      prisma.friendRelationship.findMany({
        where,
        include: { requester: { select: userSummary } },
        orderBy: { createdAt: 'desc' },
        skip: pg.skip,
        take: pg.limit
      }),
      prisma.friendRelationship.count({ where })
    ]);
    const data = rows.map((r) => ({
      id: r.id,
      requesterId: r.requesterId,
      requester: r.requester,
      createdAt: r.createdAt
    }));
    paginatedResponse(res, data, total, pg);
  })
);

// ─── GET / — accepted friends (either direction) ──────────────────────────────
router.get(
  '/',
  requireAuth,
  validateQuery(friendsQuerySchema),
  authHandler(async (req, res) => {
    const pg = parsedPage(res);
    const where = {
      status: FriendStatus.accepted,
      OR: [{ requesterId: req.user.id }, { recipientId: req.user.id }]
    };
    const [rows, total] = await Promise.all([
      prisma.friendRelationship.findMany({
        where,
        include: {
          requester: { select: userSummary },
          recipient: { select: userSummary }
        },
        orderBy: { createdAt: 'desc' },
        skip: pg.skip,
        take: pg.limit
      }),
      prisma.friendRelationship.count({ where })
    ]);
    const data = rows.map((r) => {
      const friend = r.requesterId === req.user.id ? r.recipient : r.requester;
      return {
        id: r.id,
        friendId: friend.id,
        comment: r.comment,
        status: r.status,
        createdAt: r.createdAt,
        friend
      };
    });
    paginatedResponse(res, data, total, pg);
  })
);

// ─── POST /:userId — send a friend request ────────────────────────────────────
// If the target has already sent the actor a pending request, this accepts it
// (so two opposite-direction pending rows never coexist).
router.post(
  '/:userId',
  requireAuth,
  validateParams(userIdParams),
  authHandler(async (req, res) => {
    const { userId: otherId } = parsedParams<{ userId: number }>(res);

    if (otherId === req.user.id) {
      throw new AppError(400, 'Cannot add yourself as a friend');
    }

    const target = await prisma.user.findUnique({
      where: { id: otherId },
      select: { id: true, disabled: true }
    });
    if (!target || target.disabled) {
      throw new AppError(404, 'User not found');
    }

    const existing = await prisma.friendRelationship.findFirst({
      where: betweenUsers(req.user.id, otherId)
    });

    if (existing) {
      if (existing.status === FriendStatus.accepted) {
        throw new AppError(409, 'Already friends');
      }
      if (existing.status === FriendStatus.pending) {
        if (existing.requesterId === req.user.id) {
          throw new AppError(409, 'Friend request already pending');
        }
        // Reverse pending request exists → accept it instead of duplicating.
        const accepted = await prisma.friendRelationship.update({
          where: { id: existing.id },
          data: { status: FriendStatus.accepted },
          include: {
            requester: { select: userSummary },
            recipient: { select: userSummary }
          }
        });
        const friend = accepted.requester;
        res.status(200).json({
          id: accepted.id,
          friendId: friend.id,
          status: accepted.status,
          comment: accepted.comment,
          friend
        });
        return;
      }
      // A prior rejected row exists — clear it so a fresh request can be made.
      await prisma.friendRelationship.delete({ where: { id: existing.id } });
    }

    let created;
    try {
      created = await prisma.friendRelationship.create({
        data: { requesterId: req.user.id, recipientId: otherId },
        include: { recipient: { select: userSummary } }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          throw new AppError(409, 'Friend request already pending');
        }
        if (err.code === 'P2003') throw new AppError(404, 'User not found');
      }
      throw err;
    }

    res.status(201).json({
      id: created.id,
      requesterId: created.requesterId,
      recipientId: created.recipientId,
      status: created.status,
      createdAt: created.createdAt,
      recipient: created.recipient
    });
  })
);

// ─── POST /:userId/accept — accept a pending request from :userId ─────────────
router.post(
  '/:userId/accept',
  requireAuth,
  validateParams(userIdParams),
  authHandler(async (req, res) => {
    const { userId: otherId } = parsedParams<{ userId: number }>(res);
    const pending = await prisma.friendRelationship.findFirst({
      where: {
        requesterId: otherId,
        recipientId: req.user.id,
        status: FriendStatus.pending
      }
    });
    if (!pending) {
      throw new AppError(404, 'No pending friend request from this user');
    }
    const accepted = await prisma.friendRelationship.update({
      where: { id: pending.id },
      data: { status: FriendStatus.accepted },
      include: { requester: { select: userSummary } }
    });
    res.json({
      id: accepted.id,
      friendId: accepted.requester.id,
      status: accepted.status,
      comment: accepted.comment,
      friend: accepted.requester
    });
  })
);

// ─── POST /:userId/reject — reject a pending request from :userId ─────────────
router.post(
  '/:userId/reject',
  requireAuth,
  validateParams(userIdParams),
  authHandler(async (req, res) => {
    const { userId: otherId } = parsedParams<{ userId: number }>(res);
    const result = await prisma.friendRelationship.updateMany({
      where: {
        requesterId: otherId,
        recipientId: req.user.id,
        status: FriendStatus.pending
      },
      data: { status: FriendStatus.rejected }
    });
    if (result.count === 0) {
      throw new AppError(404, 'No pending friend request from this user');
    }
    res.json({ msg: 'Friend request rejected' });
  })
);

// ─── DELETE /:userId — remove friend / cancel request (either direction) ──────
router.delete(
  '/:userId',
  requireAuth,
  validateParams(userIdParams),
  authHandler(async (req, res) => {
    const { userId: otherId } = parsedParams<{ userId: number }>(res);
    await prisma.friendRelationship.deleteMany({
      where: betweenUsers(req.user.id, otherId)
    });
    res.status(204).send();
  })
);

// ─── PUT /:userId/comment — note on an accepted friendship ────────────────────
router.put(
  '/:userId/comment',
  requireAuth,
  validateParams(userIdParams),
  validate(commentSchema),
  authHandler(async (req, res) => {
    const { userId: otherId } = parsedParams<{ userId: number }>(res);
    const { comment } = parsedBody<{ comment: string }>(res);

    const result = await prisma.friendRelationship.updateMany({
      where: {
        status: FriendStatus.accepted,
        ...betweenUsers(req.user.id, otherId)
      },
      data: { comment: sanitizePlain(comment) }
    });

    if (result.count === 0) {
      throw new AppError(404, 'Friend not found');
    }

    res.json({ msg: 'Comment updated' });
  })
);

export default router;
