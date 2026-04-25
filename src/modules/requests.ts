import { ReleaseType, RequestStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { economy } from './config';
import { CreateRequestInput } from '../schemas/requests';

export const MINIMUM_BOUNTY = BigInt(economy.minimumBounty);

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
    bounties: request.bounties?.map((b) => ({
      ...b,
      amount: b.amount.toString()
    }))
  };
}

// ─── createRequest ─────────────────────────────────────────────────────────────

export async function createRequest(userId: number, input: CreateRequestInput) {
  if (input.bounty < MINIMUM_BOUNTY) {
    throw new AppError(400, `Minimum bounty is ${MINIMUM_BOUNTY} bytes`);
  }

  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, 'User not found');
    if (user.uploaded < input.bounty) {
      throw new AppError(400, 'Insufficient upload balance');
    }

    await tx.user.update({
      where: { id: userId },
      data: { uploaded: { decrement: input.bounty } }
    });

    const request = await tx.request.create({
      data: {
        userId,
        communityId: input.communityId,
        title: input.title,
        description: input.description,
        type: input.type,
        year: input.year,
        image: input.image,
        bounties: { create: { userId, amount: input.bounty } },
        ...(input.artists?.length && {
          artists: { create: input.artists.map((id) => ({ artistId: id })) }
        })
      },
      include: { bounties: true, artists: true }
    });

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
    const request = await tx.request.findUnique({
      where: { id: requestId, status: 'open', deletedAt: null }
    });
    if (!request) throw new AppError(404, 'Request not found or not open');

    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.uploaded < amount) {
      throw new AppError(400, 'Insufficient upload balance');
    }

    await tx.user.update({
      where: { id: userId },
      data: { uploaded: { decrement: amount } }
    });

    await tx.economyTransaction.create({
      data: {
        userId,
        amount: -amount,
        reason: 'REQUEST_VOTE',
        contextId: requestId,
        contextType: 'request'
      }
    });

    const existing = await tx.requestBounty.findUnique({
      where: { requestId_userId: { requestId, userId } }
    });
    if (existing) {
      await tx.requestBounty.update({
        where: { id: existing.id },
        data: { amount: { increment: amount } }
      });
    } else {
      await tx.requestBounty.create({ data: { requestId, userId, amount } });
    }

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
    const request = await tx.request.findUnique({
      where: { id: requestId, status: 'open', deletedAt: null },
      include: { bounties: true }
    });
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

    const totalBounty = request.bounties.reduce(
      (sum, b) => sum + b.amount,
      BigInt(0)
    );

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

    if (totalBounty > BigInt(0)) {
      await tx.user.update({
        where: { id: userId },
        data: { uploaded: { increment: totalBounty } }
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

// ─── unfillRequest ────────────────────────────────────────────────────────────
// Staff action. Claws back bounty from the filler and re-opens the request.

export async function unfillRequest(
  moderatorId: number,
  requestId: number,
  reason?: string
) {
  return await prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({
      where: { id: requestId, status: 'filled' },
      include: { bounties: true }
    });
    if (!request)
      throw new AppError(404, 'Request not found or not currently filled');
    if (!request.fillerId)
      throw new AppError(500, 'Filled request has no fillerId');

    const totalBounty = request.bounties.reduce(
      (sum, b) => sum + b.amount,
      BigInt(0)
    );

    if (totalBounty > BigInt(0)) {
      await tx.user.update({
        where: { id: request.fillerId },
        data: { uploaded: { decrement: totalBounty } }
      });

      await tx.economyTransaction.create({
        data: {
          userId: request.fillerId,
          amount: -totalBounty,
          reason: 'REQUEST_UNFILL',
          contextId: requestId,
          contextType: 'request',
          actorUserId: moderatorId
        }
      });
    }

    await tx.request.update({
      where: { id: requestId },
      data: {
        status: 'open',
        fillerId: null,
        filledAt: null,
        filledContributionId: null
      }
    });

    await tx.requestAction.create({
      data: {
        requestId,
        actorId: moderatorId,
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
// Soft-deletes a request. Only refunds bounties when the request is still open
// (filled requests have already paid out; staff may delete them without refund).

export async function deleteRequest(
  actorId: number,
  requestId: number,
  isStaff: boolean
) {
  return await prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({
      where: { id: requestId, deletedAt: null },
      include: { bounties: true }
    });
    if (!request) throw new AppError(404, 'Request not found');

    if (request.status === 'filled' && !isStaff) {
      throw new AppError(403, 'Only staff can delete a filled request');
    }

    // Refund bounties only for open requests (bounty not yet disbursed)
    if (request.status === 'open') {
      for (const bounty of request.bounties) {
        await tx.user.update({
          where: { id: bounty.userId },
          data: { uploaded: { increment: bounty.amount } }
        });
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
    }

    await tx.request.update({
      where: { id: requestId },
      data: { deletedAt: new Date() }
    });

    await tx.requestAction.create({
      data: {
        requestId,
        actorId,
        action: 'DELETE',
        metadata: {
          wasStatus: request.status,
          refundedCount: request.status === 'open' ? request.bounties.length : 0
        }
      }
    });
  });
}

// ─── listRequests ─────────────────────────────────────────────────────────────

export type ListRequestsOptions = {
  page?: number;
  limit?: number;
  communityId?: number;
  status?: RequestStatus;
};

export async function listRequests({
  page = 1,
  limit = 25,
  communityId,
  status
}: ListRequestsOptions = {}) {
  const skip = (Math.max(1, page) - 1) * Math.min(100, limit);
  const take = Math.min(100, limit);

  const where = {
    deletedAt: null,
    ...(communityId != null && { communityId }),
    ...(status != null && { status })
  };

  const [requests, total] = await Promise.all([
    prisma.request.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, username: true } },
        community: { select: { id: true, name: true } },
        bounties: true
      }
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
