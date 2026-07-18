import {
  DownloadGrantStatus,
  EconomyTransactionReason,
  RatioExempt
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { getLogger } from './logging';
import { computeRatio } from './ratio';
import { evaluateRatioPolicy } from './ratioPolicy';

const log = getLogger('downloads');

const IDEMPOTENCY_WINDOW_MS = 120_000; // 2 minutes

// The zero-amount ledger reason for a suppressed accrual side (PRD-06 #4).
const exemptLedgerReason = (exempt: RatioExempt): EconomyTransactionReason =>
  exempt === RatioExempt.NEUTRALPASS
    ? EconomyTransactionReason.NEUTRALPASS_GRANT
    : EconomyTransactionReason.FREEPASS_GRANT;

export interface GrantResult {
  grantId: number;
  downloadUrl: string;
  amountBytes: string;
  status: DownloadGrantStatus;
  createdAt: string;
}

export const grantDownloadAccess = async (
  consumerId: number,
  contributionId: number,
  idempotencyKey?: string
): Promise<GrantResult> => {
  const result = await prisma.$transaction(async (tx) => {
    const contribution = await tx.contribution.findUnique({
      where: { id: contributionId },
      select: {
        id: true,
        userId: true,
        downloadUrl: true,
        sizeInBytes: true,
        approvedAccountingBytes: true,
        ratioExempt: true
      }
    });
    if (!contribution) throw new AppError(404, 'Contribution not found');
    if (contribution.userId === consumerId)
      throw new AppError(403, 'You cannot consume your own contribution');

    const consumer = await tx.user.findUnique({
      where: { id: consumerId },
      select: {
        canDownload: true,
        contributed: true,
        consumed: true
      }
    });
    if (!consumer) throw new AppError(404, 'User not found');
    if (!consumer.canDownload)
      throw new AppError(403, 'Your download access has been disabled');

    const cost =
      contribution.approvedAccountingBytes ??
      (contribution.sizeInBytes != null
        ? BigInt(contribution.sizeInBytes)
        : null);
    if (!cost || cost <= 0n)
      throw new AppError(
        400,
        'This contribution has no approved accounting size set'
      );

    // Idempotency: reuse a recent COMPLETED grant to avoid double-charging
    const windowStart = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
    const existing = await tx.downloadAccessGrant.findFirst({
      where: {
        consumerId,
        contributionId,
        status: DownloadGrantStatus.COMPLETED,
        createdAt: { gte: windowStart }
      },
      orderBy: { createdAt: 'desc' }
    });
    if (existing) {
      return {
        grantId: existing.id,
        downloadUrl: contribution.downloadUrl,
        amountBytes: existing.amountBytes.toString(),
        status: existing.status,
        createdAt: existing.createdAt.toISOString()
      };
    }

    // Ratio-exempt handling (PRD-06 #4). FREEPASS suppresses the consumer's
    // `consumed`; NEUTRALPASS suppresses both sides. The balance gate is skipped
    // when consumer accrual is suppressed — the point of a Freepass is to let a
    // below-ratio member consume freely to rebuild, so there is nothing to guard.
    const exempt = contribution.ratioExempt;
    const suppressConsumer = exempt !== RatioExempt.NONE;
    const suppressContributor = exempt === RatioExempt.NEUTRALPASS;

    if (!suppressConsumer) {
      if (consumer.contributed - consumer.consumed < cost)
        throw new AppError(400, 'Insufficient contributed balance');

      // CAS: atomically increment consumed, guarding against concurrent balance drain
      const newConsumed = consumer.consumed + cost;
      const newRatio = computeRatio(consumer.contributed, newConsumed);
      const debited = await tx.user.updateMany({
        where: {
          id: consumerId,
          consumed: { lte: consumer.contributed - cost }
        },
        data: {
          consumed: { increment: cost },
          ratio: newRatio
        }
      });
      if (debited.count === 0)
        throw new AppError(409, 'Balance changed concurrently, please retry');
    }

    // Credit contributor balance and recompute ratio (skipped for NEUTRALPASS).
    if (!suppressContributor) {
      const contributor = await tx.user.findUniqueOrThrow({
        where: { id: contribution.userId },
        select: { consumed: true, contributed: true }
      });
      const newContributorRatio = computeRatio(
        contributor.contributed + cost,
        contributor.consumed
      );
      await tx.user.update({
        where: { id: contribution.userId },
        data: {
          contributed: { increment: cost },
          ratio: newContributorRatio
        }
      });
    }

    const grant = await tx.downloadAccessGrant.create({
      data: {
        consumerId,
        contributorId: contribution.userId,
        contributionId,
        amountBytes: cost,
        // Snapshot the exemption so reversal claws back exactly what accrued.
        ratioExempt: exempt,
        status: DownloadGrantStatus.COMPLETED,
        idempotencyKey: idempotencyKey ?? null
      }
    });

    // Immutable ledger. A suppressed side writes a zero-amount marker row (rather
    // than a real DEBIT/CREDIT) so the grant event still exists in the ledger for
    // the ADR-0016 korin handoff (#261), even though no balance moved.
    await tx.economyTransaction.create({
      data: {
        userId: consumerId,
        amount: suppressConsumer ? 0n : -cost,
        reason: suppressConsumer
          ? exemptLedgerReason(exempt)
          : EconomyTransactionReason.DOWNLOAD_DEBIT,
        contextId: grant.id,
        contextType: 'download'
      }
    });

    await tx.economyTransaction.create({
      data: {
        userId: contribution.userId,
        amount: suppressContributor ? 0n : cost,
        reason: suppressContributor
          ? exemptLedgerReason(exempt)
          : EconomyTransactionReason.DOWNLOAD_CREDIT,
        contextId: grant.id,
        contextType: 'download'
      }
    });

    // Upsert Consumer many-to-many for backwards compat
    const consumer_ = await tx.consumer.upsert({
      where: { userId: consumerId },
      update: {},
      create: { userId: consumerId }
    });
    await tx.consumer.update({
      where: { id: consumer_.id },
      data: {
        contributions: { connect: { id: contributionId } }
      }
    });

    return {
      grantId: grant.id,
      downloadUrl: contribution.downloadUrl,
      amountBytes: grant.amountBytes.toString(),
      status: grant.status,
      createdAt: grant.createdAt.toISOString()
    };
  });

  // Evaluate ratio policy outside the transaction so a policy error never
  // rolls back an already-committed grant.
  evaluateRatioPolicy(consumerId).catch((err) => {
    log.warn('Ratio policy evaluation failed', { consumerId, err });
  });

  return result;
};

export const reverseDownloadAccess = async (
  staffId: number,
  grantId: number,
  reason?: string
): Promise<{ grantId: number; status: DownloadGrantStatus }> => {
  return prisma.$transaction(async (tx) => {
    const grant = await tx.downloadAccessGrant.findUnique({
      where: { id: grantId }
    });
    if (!grant) throw new AppError(404, 'Grant not found');
    if (grant.status !== DownloadGrantStatus.COMPLETED)
      throw new AppError(409, 'Grant is not in COMPLETED state');

    const [consumer, contributor] = await Promise.all([
      tx.user.findUniqueOrThrow({
        where: { id: grant.consumerId },
        select: { consumed: true, contributed: true }
      }),
      tx.user.findUniqueOrThrow({
        where: { id: grant.contributorId },
        select: { consumed: true, contributed: true }
      })
    ]);

    // Mirror the grant's exemption (snapshotted at grant time): only reverse a
    // side that actually accrued. Clawing back `amountBytes` on a suppressed side
    // would manufacture negative balance out of nothing (PRD-06 #4).
    const suppressConsumer = grant.ratioExempt !== RatioExempt.NONE;
    const suppressContributor = grant.ratioExempt === RatioExempt.NEUTRALPASS;

    // Refund consumer (consumed decrements; contributed unchanged).
    if (!suppressConsumer) {
      const consumerNewConsumed = consumer.consumed - grant.amountBytes;
      const consumerNewRatio = computeRatio(
        consumer.contributed,
        consumerNewConsumed < 0n ? 0n : consumerNewConsumed
      );
      await tx.user.update({
        where: { id: grant.consumerId },
        data: {
          consumed: { decrement: grant.amountBytes },
          ratio: consumerNewRatio
        }
      });
    }

    // Claw back from contributor balance.
    if (!suppressContributor) {
      const contribNewContributed =
        contributor.contributed >= grant.amountBytes
          ? contributor.contributed - grant.amountBytes
          : 0n;
      const contribNewRatio = computeRatio(
        contribNewContributed,
        contributor.consumed
      );
      await tx.user.update({
        where: { id: grant.contributorId },
        data: {
          contributed: { decrement: grant.amountBytes },
          ratio: contribNewRatio
        }
      });
    }

    // Reversal ledger entries — zero on a side whose grant accrual was suppressed,
    // mirroring the marker rows the grant wrote (every grant stays paired).
    await tx.economyTransaction.create({
      data: {
        userId: grant.consumerId,
        amount: suppressConsumer ? 0n : grant.amountBytes,
        reason: EconomyTransactionReason.STAFF_REVERSAL,
        contextId: grant.id,
        contextType: 'download',
        actorUserId: staffId
      }
    });
    await tx.economyTransaction.create({
      data: {
        userId: grant.contributorId,
        amount: suppressContributor ? 0n : -grant.amountBytes,
        reason: EconomyTransactionReason.STAFF_REVERSAL,
        contextId: grant.id,
        contextType: 'download',
        actorUserId: staffId
      }
    });

    const updated = await tx.downloadAccessGrant.update({
      where: { id: grantId },
      data: {
        status: DownloadGrantStatus.REVERSED,
        reversedAt: new Date(),
        reversalReason: reason ?? null,
        reversedById: staffId
      }
    });

    return { grantId: updated.id, status: updated.status };
  });
};
