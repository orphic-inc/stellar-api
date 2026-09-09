import express from 'express';
import { z } from 'zod';
import { FriendStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { translatePrismaError } from '../../lib/prismaErrors';
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
import { friendCommentSchema } from '../../schemas/friends';

const router = express.Router();

const friendsQuerySchema = z.object({ ...paginationBase });

const userIdParams = z.object({
  userId: z.coerce.number().int().positive()
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
      'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'rejected' =
      'none';
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

/**
 * Accept an existing pending request, as the response body the route sends.
 *
 * Split out of the request handler to keep it inside Codacy's per-function
 * limits once its #564 guard was added — a guard has to sit lexically in the
 * handler that owns the write, so this branch moves instead.
 */
const acceptExisting = async (id: number) => {
  let accepted;
  try {
    accepted = await prisma.friendRelationship.update({
      where: { id },
      data: { status: FriendStatus.accepted },
      include: {
        requester: { select: userSummary },
        recipient: { select: userSummary }
      }
    });
  } catch (err) {
    translatePrismaError(err, {
      P2025: [404, 'No pending friend request from this user']
    });
  }
  const friend = accepted.requester;
  return {
    id: accepted.id,
    friendId: friend.id,
    status: accepted.status,
    comment: accepted.comment,
    friend
  };
};

/** The target must exist and be active before a request can be sent. */
const assertRequestable = async (otherId: number): Promise<void> => {
  const target = await prisma.user.findUnique({
    where: { id: otherId },
    select: { id: true, disabled: true }
  });
  if (!target || target.disabled) throw new AppError(404, 'User not found');
};

/**
 * What to do about a relationship that already exists between the two users:
 * refuse it, accept the reverse pending request (returning the response body),
 * or clear a rejected row so a fresh request can be made (returning `null`).
 */
const resolveExisting = async (
  existing: { id: number; status: FriendStatus; requesterId: number },
  actorId: number
) => {
  if (existing.status === FriendStatus.accepted) {
    throw new AppError(409, 'Already friends');
  }
  if (existing.status === FriendStatus.pending) {
    if (existing.requesterId === actorId) {
      throw new AppError(409, 'Friend request already pending');
    }
    // Reverse pending request exists → accept it instead of duplicating.
    return acceptExisting(existing.id);
  }
  // A prior rejected row exists — clear it so a fresh request can be made.
  try {
    await prisma.friendRelationship.delete({ where: { id: existing.id } });
  } catch (err) {
    translatePrismaError(err, {
      P2025: [404, 'No pending friend request from this user']
    });
  }
  return null;
};

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

    await assertRequestable(otherId);

    const existing = await prisma.friendRelationship.findFirst({
      where: betweenUsers(req.user.id, otherId)
    });

    if (existing) {
      const accepted = await resolveExisting(existing, req.user.id);
      if (accepted) {
        res.status(200).json(accepted);
        return;
      }
    }

    let created;
    try {
      created = await prisma.friendRelationship.create({
        data: { requesterId: req.user.id, recipientId: otherId },
        include: { recipient: { select: userSummary } }
      });
    } catch (err) {
      translatePrismaError(err, {
        P2002: [409, 'Friend request already pending'],
        P2003: [404, 'User not found']
      });
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
    let accepted;
    try {
      accepted = await prisma.friendRelationship.update({
        where: { id: pending.id },
        data: { status: FriendStatus.accepted },
        include: { requester: { select: userSummary } }
      });
    } catch (err) {
      translatePrismaError(err, {
        P2025: [404, 'No pending friend request from this user']
      });
    }
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
  validate(friendCommentSchema),
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
