import { Prisma, ReleaseType, RequestStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { translatePrismaError } from '../lib/prismaErrors';
import { communityReadableWhere, requestVisibleTo } from './communityAccess';
import { AppError } from '../lib/errors';
import { economy } from './config';
import { debitBalance, decrementFloored } from './ratio';
import { CreateRequestInput, UpdateRequestInput } from '../schemas/requests';
import { emitNotifications } from '../lib/notifications';
import { registerWriteImages } from './remoteImage';

export const MINIMUM_BOUNTY = BigInt(economy.minimumBounty);

// ─── Capability types ─────────────────────────────────────────────────────────

export type RequestActor = {
  actorId: number;
  canModerateRequests: boolean;
};

export type OptionalRequestActor = {
  actorId?: number;
  canModerateRequests?: boolean;
};

// ─── DTO serialization ────────────────────────────────────────────────────────

type RawBounty = {
  id: number;
  requestId: number;
  userId: number;
  amount: bigint;
  createdAt: Date;
  user?: { id: number; username: string };
};

export type SerializedRequest = {
  id: number;
  communityId: number;
  userId: number;
  title: string;
  description: string;
  type: string;
  year: number | null;
  image: string | null;
  status: string;
  fillerId: number | null;
  filledAt: Date | null;
  filledContributionId: number | null;
  totalBounty: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  user?: { id: number; username: string };
  filler?: { id: number; username: string } | null;
  community?: { id: number; name: string };
  _count: { bounties: number };
  bounties?: Array<Omit<RawBounty, 'amount'> & { amount: string }>;
  artists?: unknown[];
  filledContribution?: unknown;
};

export function serializeRequest(request: {
  id: number;
  communityId: number;
  userId: number;
  title: string;
  description: string;
  type: ReleaseType;
  year: number | null;
  image: string | null;
  status: RequestStatus;
  fillerId: number | null;
  filledAt: Date | null;
  filledContributionId: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  bounties?: RawBounty[];
  user?: { id: number; username: string };
  filler?: { id: number; username: string } | null;
  community?: { id: number; name: string };
  artists?: unknown[];
  filledContribution?: unknown;
}): SerializedRequest {
  const totalBounty = (request.bounties ?? []).reduce(
    (sum, b) => sum + b.amount,
    BigInt(0)
  );
  return {
    ...request,
    totalBounty: totalBounty.toString(),
    _count: { bounties: request.bounties?.length ?? 0 },
    bounties: request.bounties?.map((b) => ({
      ...b,
      amount: b.amount.toString()
    }))
  };
}

// ─── getRequestDetail ─────────────────────────────────────────────────────────

export async function getRequestDetail(
  requestId: number,
  viewerId: number
): Promise<
  SerializedRequest & {
    voteCount: number;
    votes: Array<{ userId: number }>;
  }
> {
  // findFirst, not findUnique: the community scope is a relation filter, which
  // findUnique cannot express. An unreachable request simply is not found, so it
  // answers the same 404 as one that does not exist — a distinguishable 403
  // would confirm that a private community holds a request with this id (#547,
  // following #509's reasoning about existence oracles).
  const request = await prisma.request.findFirst({
    where: {
      id: requestId,
      deletedAt: null,
      ...requestVisibleTo(viewerId)
    },
    include: {
      user: { select: { id: true, username: true } },
      filler: { select: { id: true, username: true } },
      community: { select: { id: true, name: true } },
      artists: { include: { artist: true } },
      bounties: {
        include: { user: { select: { id: true, username: true } } }
      },
      filledContribution: {
        include: {
          release: { select: { id: true, title: true } },
          user: { select: { id: true, username: true } }
        }
      },
      votes: { select: { userId: true } }
    }
  });
  if (!request) throw new AppError(404, 'Request not found');

  const serialized = serializeRequest(request);
  return {
    ...serialized,
    voteCount: request.voteCount,
    votes: request.votes
  };
}

// ─── getBountyHistory ─────────────────────────────────────────────────────────

export async function getBountyHistory(requestId: number, viewerId: number) {
  // A request the viewer cannot reach answers as a missing one (#755).
  const request = await prisma.request.findFirst({
    where: { id: requestId, deletedAt: null, ...requestVisibleTo(viewerId) },
    select: { id: true }
  });
  if (!request) throw new AppError(404, 'Request not found');

  const [bounties, actions] = await Promise.all([
    prisma.requestBounty.findMany({
      where: { requestId },
      include: { user: { select: { id: true, username: true } } },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.requestAction.findMany({
      where: { requestId },
      orderBy: { createdAt: 'desc' }
    })
  ]);

  return { bounties, actions };
}

// ─── toggleVote ───────────────────────────────────────────────────────────────

const VOTE_RACED: [number, string] = [
  409,
  'Your vote changed in another request; reload and try again'
];

export async function toggleVote(
  requestId: number,
  userId: number
): Promise<{ voted: boolean }> {
  const request = await prisma.request.findFirst({
    where: { id: requestId, deletedAt: null, ...requestVisibleTo(userId) },
    select: { id: true }
  });
  if (!request) throw new AppError(404, 'Request not found');

  const existing = await prisma.requestVote.findUnique({
    where: { requestId_userId: { requestId, userId } }
  });

  // A second toggle racing this one can remove the vote this read found, or
  // insert the one it did not (#756). Either way the caller's view is stale.
  const raced = { P2002: VOTE_RACED, P2025: VOTE_RACED };

  if (existing) {
    try {
      await prisma.$transaction([
        prisma.requestVote.delete({
          where: { requestId_userId: { requestId, userId } }
        }),
        prisma.request.update({
          where: { id: requestId },
          data: { voteCount: { decrement: 1 } }
        })
      ]);
    } catch (err) {
      translatePrismaError(err, raced);
    }
    return { voted: false };
  }

  try {
    await prisma.$transaction([
      prisma.requestVote.create({
        data: { requestId, userId }
      }),
      prisma.request.update({
        where: { id: requestId },
        data: { voteCount: { increment: 1 } }
      })
    ]);
  } catch (err) {
    translatePrismaError(err, raced);
  }
  return { voted: true };
}

// ─── updateRequest ────────────────────────────────────────────────────────────

export async function updateRequest({
  requestId,
  actorId,
  canModerateRequests,
  input
}: {
  requestId: number;
  actorId: number;
  canModerateRequests: boolean;
  input: UpdateRequestInput;
}): Promise<SerializedRequest> {
  const existing = await prisma.request.findFirst({
    where: { id: requestId, deletedAt: null, ...requestVisibleTo(actorId) },
    select: { userId: true, status: true }
  });
  if (!existing) throw new AppError(404, 'Request not found');
  if (existing.status !== 'open')
    throw new AppError(422, 'Only open requests can be edited');

  if (existing.userId !== actorId && !canModerateRequests)
    throw new AppError(403, 'Permission denied');
  // Before the write, so a 429 refuses the edit whole (#737).
  await registerWriteImages({ fields: [input.image] }, actorId);

  const updated = await prisma.request.update({
    where: { id: requestId },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && {
        description: input.description
      }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.year !== undefined && { year: input.year }),
      ...(input.image !== undefined && { image: input.image })
    },
    include: {
      user: { select: { id: true, username: true } },
      bounties: true
    }
  });
  return serializeRequest(updated);
}

// ─── createRequest ─────────────────────────────────────────────────────────────

export async function createRequest(userId: number, input: CreateRequestInput) {
  if (input.bounty < MINIMUM_BOUNTY) {
    throw new AppError(400, `Minimum bounty is ${MINIMUM_BOUNTY} bytes`);
  }
  await registerWriteImages({ fields: [input.image] }, userId);

  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, 'User not found');

    // Unreachable answers as unknown does, the P2003 arm below (#755).
    const community = await tx.community.findFirst({
      where: { id: input.communityId, ...communityReadableWhere(userId) },
      select: { id: true }
    });
    if (!community)
      throw new AppError(400, 'communityId or an artist id names nothing');
    await debitBalance(tx, userId, user, input.bounty);

    // A repeated artist id means the same artist; de-duplicated rather than
    // refused, since RequestArtist is unique per request (#756).
    const artistIds = [...new Set(input.artists ?? [])];
    let request;
    try {
      request = await tx.request.create({
        data: {
          userId,
          communityId: input.communityId,
          title: input.title,
          description: input.description,
          type: input.type,
          year: input.year,
          image: input.image,
          bounties: { create: { userId, amount: input.bounty } },
          ...(artistIds.length > 0 && {
            artists: { create: artistIds.map((id) => ({ artistId: id })) }
          })
        },
        include: { bounties: true, artists: true }
      });
    } catch (err) {
      // Both ids come from the body, and nothing checked either (#756).
      translatePrismaError(err, {
        P2003: [400, 'communityId or an artist id names nothing']
      });
    }

    // contextId is known at creation time — no null-context race possible
    await tx.economyTransaction.create({
      data: {
        userId,
        amount: -input.bounty,
        reason: 'REQUEST_CREATE',
        contextId: request.id,
        contextType: 'request'
      }
    });

    await tx.requestAction.create({
      data: {
        requestId: request.id,
        actorId: userId,
        action: 'CREATE',
        metadata: { bounty: input.bounty.toString() }
      }
    });

    return serializeRequest(request);
  });
}

// ─── addBounty ────────────────────────────────────────────────────────────────

/** Add `amount` to the member's bounty on a request, creating it on the first. */
async function pledgeBounty(
  tx: Prisma.TransactionClient,
  requestId: number,
  userId: number,
  amount: bigint
) {
  const existing = await tx.requestBounty.findUnique({
    where: { requestId_userId: { requestId, userId } }
  });
  if (existing) {
    await tx.requestBounty.update({
      where: { id: existing.id },
      data: { amount: { increment: amount } }
    });
    return;
  }
  // Two first bounties by one member can both miss `existing` (#756).
  try {
    await tx.requestBounty.create({ data: { requestId, userId, amount } });
  } catch (err) {
    translatePrismaError(err, {
      P2002: [409, 'Your bounty changed in another request; try again']
    });
  }
}

/**
 * An open request the viewer can reach, or null (#755). A request in a
 * community they cannot see is not found, exactly as a missing one is.
 */
const findOpenRequest = (
  tx: Prisma.TransactionClient,
  requestId: number,
  viewerId: number
) =>
  tx.request.findFirst({
    where: {
      id: requestId,
      status: 'open',
      deletedAt: null,
      ...requestVisibleTo(viewerId)
    }
  });

export async function addBounty(
  userId: number,
  requestId: number,
  amount: bigint
) {
  if (amount < MINIMUM_BOUNTY) {
    throw new AppError(
      400,
      `Minimum bounty addition is ${MINIMUM_BOUNTY} bytes`
    );
  }

  return await prisma.$transaction(async (tx) => {
    // Visibility is read here (#755), not in the claim's scalar updateMany.
    if (!(await findOpenRequest(tx, requestId, userId)))
      throw new AppError(404, 'Request not found or not open');

    // Claim the request row first (#767). A fill, unfill or delete claims the
    // same row, so this bounty either commits before theirs, and they read it
    // after their claim, or waits and then finds the request no longer open.
    const claimed = await tx.request.updateMany({
      where: { id: requestId, status: 'open', deletedAt: null },
      data: { updatedAt: new Date() }
    });
    if (claimed.count === 0)
      throw new AppError(404, 'Request not found or not open');

    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(400, 'Insufficient contributed balance');
    await debitBalance(tx, userId, user, amount);

    await tx.economyTransaction.create({
      data: {
        userId,
        amount: -amount,
        reason: 'REQUEST_VOTE',
        contextId: requestId,
        contextType: 'request'
      }
    });

    await pledgeBounty(tx, requestId, userId, amount);

    await tx.requestAction.create({
      data: {
        requestId,
        actorId: userId,
        action: 'ADD_BOUNTY',
        metadata: { amount: amount.toString() }
      }
    });

    const updated = await tx.request.findUnique({
      where: { id: requestId },
      include: {
        bounties: {
          include: { user: { select: { id: true, username: true } } }
        }
      }
    });
    return serializeRequest(updated!);
  });
}

// ─── fillRequest ──────────────────────────────────────────────────────────────
// Fills a request using a contribution owned by the caller.
// Uses a compare-and-swap updateMany to prevent double-fills under concurrent load.

export async function fillRequest(
  userId: number,
  requestId: number,
  contributionId: number
) {
  return await prisma.$transaction(async (tx) => {
    const contribution = await tx.contribution.findUnique({
      where: { id: contributionId },
      include: { release: true }
    });
    if (!contribution) throw new AppError(404, 'Contribution not found');

    // Ownership: caller must own the contribution
    if (contribution.userId !== userId) {
      throw new AppError(
        403,
        'You can only fill a request with your own contribution'
      );
    }

    // Pre-validate against the request before the atomic step
    const request = await findOpenRequest(tx, requestId, userId);
    if (!request) throw new AppError(404, 'Request not found or not open');

    if (contribution.release.communityId !== request.communityId) {
      throw new AppError(
        400,
        'Contribution must belong to the same community as the request'
      );
    }
    if (contribution.release.type !== request.type) {
      throw new AppError(
        400,
        'Contribution release type does not match request type'
      );
    }

    // Guard against the same contribution already filling a different request
    const existingFill = await tx.request.findFirst({
      where: {
        filledContributionId: contributionId,
        status: 'filled',
        deletedAt: null
      }
    });
    if (existingFill) {
      throw new AppError(
        400,
        'This contribution is already the active fill for another request'
      );
    }

    // Atomic open → filled transition: only succeeds if still open
    const result = await tx.request.updateMany({
      where: { id: requestId, status: 'open', deletedAt: null },
      data: {
        status: 'filled',
        fillerId: userId,
        filledAt: new Date(),
        filledContributionId: contributionId
      }
    });

    // count !== 1 means a concurrent fill won the race
    if (result.count !== 1) {
      throw new AppError(
        409,
        'Request was already filled by another submission'
      );
    }

    // Total the bounties after the claim (#767): a bounty committed after the
    // pre-read is paid too, and none can be added while the claim is held.
    const bounties = await tx.requestBounty.findMany({ where: { requestId } });
    const totalBounty = bounties.reduce((sum, b) => sum + b.amount, BigInt(0));

    if (totalBounty > BigInt(0)) {
      await tx.user.update({
        where: { id: userId },
        data: {
          contributed: { increment: totalBounty }
        }
      });

      await tx.economyTransaction.create({
        data: {
          userId,
          amount: totalBounty,
          reason: 'REQUEST_FILL',
          contextId: requestId,
          contextType: 'request'
        }
      });
    }

    await tx.requestFill.create({
      data: {
        requestId,
        contributionId,
        fillerId: userId,
        awardedAmount: totalBounty
      }
    });

    await tx.requestAction.create({
      data: {
        requestId,
        actorId: userId,
        action: 'FILL',
        metadata: {
          contributionId,
          awardedAmount: totalBounty.toString()
        }
      }
    });

    // Notify requester + all bounty contributors (excluding the filler)
    const interestedUserIds = [
      request.userId,
      ...bounties.map((b) => b.userId)
    ];
    const uniqueIds = [...new Set(interestedUserIds)];
    await emitNotifications(tx, {
      userIds: uniqueIds,
      type: 'request_filled',
      actorId: userId,
      page: 'requests',
      pageId: requestId
    });

    const filled = await tx.request.findUnique({
      where: { id: requestId },
      include: {
        user: { select: { id: true, username: true } },
        filler: { select: { id: true, username: true } },
        bounties: true
      }
    });
    return serializeRequest(filled!);
  });
}

/**
 * Claw back from the filler exactly what their fill was paid: the latest
 * RequestFill's `awardedAmount` (#767). Call after the unfill's claim.
 */
async function clawBackFill(
  tx: Prisma.TransactionClient,
  requestId: number,
  fillerId: number,
  actorId: number
) {
  const fill = await tx.requestFill.findFirst({
    where: { requestId, fillerId },
    orderBy: { id: 'desc' }
  });
  if (!fill) throw new AppError(500, 'Filled request has no fill record');
  if (fill.awardedAmount <= BigInt(0)) return;

  await decrementFloored(tx, fillerId, 'contributed', fill.awardedAmount);
  await tx.economyTransaction.create({
    data: {
      userId: fillerId,
      amount: -fill.awardedAmount,
      reason: 'REQUEST_UNFILL',
      contextId: requestId,
      contextType: 'request',
      actorUserId: actorId
    }
  });
}

/**
 * Refund every bounty on a deleted open request (#767), read after the
 * delete's claim so a bounty committed before it is refunded too.
 * Returns how many were refunded.
 */
async function refundBounties(
  tx: Prisma.TransactionClient,
  requestId: number,
  actorId: number
): Promise<number> {
  const bounties = await tx.requestBounty.findMany({ where: { requestId } });
  for (const bounty of bounties) {
    await decrementFloored(tx, bounty.userId, 'consumed', bounty.amount);
    await tx.economyTransaction.create({
      data: {
        userId: bounty.userId,
        amount: bounty.amount,
        reason: 'REQUEST_REFUND',
        contextId: requestId,
        contextType: 'request',
        actorUserId: actorId
      }
    });
  }
  return bounties.length;
}

// ─── unfillRequest ────────────────────────────────────────────────────────────
// Now owns authorization: owner, filler, or moderator may unfill.
// Claws back bounty from the filler and re-opens the request.

export async function unfillRequest({
  requestId,
  actorId,
  canModerateRequests,
  reason
}: {
  requestId: number;
  actorId: number;
  canModerateRequests: boolean;
  reason?: string;
}): Promise<SerializedRequest> {
  return await prisma.$transaction(async (tx) => {
    const request = await tx.request.findFirst({
      where: { id: requestId, deletedAt: null, ...requestVisibleTo(actorId) }
    });
    if (!request) throw new AppError(404, 'Request not found');
    if (request.status !== 'filled')
      throw new AppError(422, 'Request is not filled');

    const isOwner = request.userId === actorId;
    const isFiller = request.fillerId === actorId;
    if (!canModerateRequests && !isOwner && !isFiller)
      throw new AppError(403, 'Permission denied');

    if (!request.fillerId)
      throw new AppError(500, 'Filled request has no fillerId');

    // Claim before any money moves (#767): of two concurrent unfills only one
    // matches. Pinning the filler read above means an unfill that raced an
    // unfill-and-refill cannot clear the new fill while clawing back from the
    // old filler.
    const claimed = await tx.request.updateMany({
      where: {
        id: requestId,
        status: 'filled',
        deletedAt: null,
        fillerId: request.fillerId
      },
      data: {
        status: 'open',
        fillerId: null,
        filledAt: null,
        filledContributionId: null
      }
    });
    if (claimed.count === 0) throw new AppError(422, 'Request is not filled');

    await clawBackFill(tx, requestId, request.fillerId, actorId);

    await tx.requestAction.create({
      data: {
        requestId,
        actorId,
        action: 'UNFILL',
        metadata: {
          previousFillerId: request.fillerId,
          reason: reason ?? null
        }
      }
    });

    const updated = await tx.request.findUnique({
      where: { id: requestId },
      include: { bounties: true }
    });
    return serializeRequest(updated!);
  });
}

// ─── deleteRequest ────────────────────────────────────────────────────────────
// Now owns authorization: owner (open only) or moderator (any status) may delete.
// Soft-deletes a request. Only refunds bounties when the request is still open
// (filled requests have already paid out; staff may delete them without refund).

export async function deleteRequest({
  requestId,
  actorId,
  canModerateRequests
}: {
  requestId: number;
  actorId: number;
  canModerateRequests: boolean;
}) {
  return await prisma.$transaction(async (tx) => {
    const request = await tx.request.findFirst({
      where: { id: requestId, deletedAt: null, ...requestVisibleTo(actorId) }
    });
    if (!request) throw new AppError(404, 'Request not found');

    const isOwner = request.userId === actorId;
    if (!isOwner && !canModerateRequests)
      throw new AppError(403, 'Permission denied');

    if (request.status === 'filled' && !canModerateRequests) {
      throw new AppError(403, 'Only staff can delete a filled request');
    }

    // Claim before any money moves (#767), pinning the status read above: of
    // two concurrent deletes only one refunds, and a delete that raced a fill
    // cannot refund bounties the fill has just paid out.
    const claimed = await tx.request.updateMany({
      where: { id: requestId, deletedAt: null, status: request.status },
      data: { deletedAt: new Date() }
    });
    if (claimed.count === 0) throw new AppError(404, 'Request not found');

    // Refund bounties only for open requests (bounty not yet disbursed)
    const refundedCount =
      request.status === 'open'
        ? await refundBounties(tx, requestId, actorId)
        : 0;

    await tx.requestAction.create({
      data: {
        requestId,
        actorId,
        action: 'DELETE',
        metadata: {
          wasStatus: request.status,
          refundedCount
        }
      }
    });
  });
}

// ─── listRequests ─────────────────────────────────────────────────────────────

export type ListRequestsOptions = {
  q?: string;
  artist?: string;
  type?: ReleaseType;
  year?: number;
  page?: number;
  limit?: number;
  communityId?: number;
  status?: RequestStatus;
  orderBy?: 'createdAt' | 'voteCount' | 'random';
  order?: 'asc' | 'desc';
  /** The caller. Requests in communities they cannot reach are excluded (#547). */
  viewerId: number;
};

export async function listRequests({
  q,
  artist,
  type,
  year,
  page = 1,
  limit = 25,
  communityId,
  status,
  orderBy = 'createdAt',
  order = 'desc',
  viewerId
}: ListRequestsOptions) {
  const skip = (Math.max(1, page) - 1) * Math.min(100, limit);
  const take = Math.min(100, limit);

  // `communityId` below is a caller-supplied FILTER. On its own that let anyone
  // read requests in PRIVATE communities — and the projection carries the
  // community's NAME — which is exactly the defect #509 F2 fixed for
  // `/search/requests`. The scope is the restriction; the filter narrows within
  // it. Every request HAS a community — `Request.communityId` is non-nullable,
  // unlike `Release.communityId` — so unlike the release scope #509 built there
  // is no community-less set to preserve here.
  //
  // This FILTERS rather than 403s, deliberately and for #509's reason: refusing
  // when the caller names a community would make `?communityId=N` an existence
  // oracle for private communities.
  const scope = requestVisibleTo(viewerId);

  const where: Record<string, unknown> = {
    AND: [scope],
    deletedAt: null,
    ...(q && {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } }
      ]
    }),
    ...(artist && {
      artists: {
        some: { artist: { name: { contains: artist, mode: 'insensitive' } } }
      }
    }),
    ...(type != null && { type }),
    ...(year != null && { year }),
    ...(communityId != null && { communityId }),
    ...(status != null && { status })
  };

  const include = {
    user: { select: { id: true, username: true } },
    community: { select: { id: true, name: true } },
    bounties: true
  } as const;

  if (orderBy === 'random') {
    const total = await prisma.request.count({ where });
    const randomSkip =
      total > take ? Math.floor(Math.random() * (total - take)) : 0;
    const requests = await prisma.request.findMany({
      where,
      skip: randomSkip,
      take,
      include
    });

    return {
      data: requests.map(serializeRequest),
      meta: {
        total,
        page: Math.max(1, page),
        limit: take,
        totalPages: Math.ceil(total / take)
      }
    };
  }

  const [requests, total] = await Promise.all([
    prisma.request.findMany({
      where,
      skip,
      take,
      orderBy: [{ [orderBy]: order }, { id: 'asc' }],
      include
    }),
    prisma.request.count({ where })
  ]);

  return {
    data: requests.map(serializeRequest),
    meta: {
      total,
      page: Math.max(1, page),
      limit: take,
      totalPages: Math.ceil(total / take)
    }
  };
}
