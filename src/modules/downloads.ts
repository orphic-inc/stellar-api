import { DownloadGrantStatus, EconomyTransactionReason } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

const IDEMPOTENCY_WINDOW_MS = 120_000; // 2 minutes

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
  return prisma.$transaction(async (tx) => {
    const contribution = await tx.contribution.findUnique({
      where: { id: contributionId },
      select: {
        id: true,
        userId: true,
        downloadUrl: true,
        sizeInBytes: true,
        approvedAccountingBytes: true
      }
    });
    if (!contribution) throw new AppError(404, 'Contribution not found');

    const consumer = await tx.user.findUnique({
      where: { id: consumerId },
      select: { canDownload: true, uploaded: true }
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

    if (consumer.uploaded < cost)
      throw new AppError(400, 'Insufficient upload balance');

    // CAS: atomically debit consumer's balance
    const debited = await tx.user.updateMany({
      where: { id: consumerId, uploaded: { gte: cost } },
      data: { uploaded: { decrement: cost }, downloaded: { increment: cost } }
    });
    if (debited.count === 0)
      throw new AppError(409, 'Balance changed concurrently, please retry');

    // Credit contributor balance and gross earnings
    await tx.user.update({
      where: { id: contribution.userId },
      data: {
        uploaded: { increment: cost },
        totalEarned: { increment: cost }
      }
    });

    const grant = await tx.downloadAccessGrant.create({
      data: {
        consumerId,
        contributorId: contribution.userId,
        contributionId,
        amountBytes: cost,
        status: DownloadGrantStatus.COMPLETED,
        idempotencyKey: idempotencyKey ?? null
      }
    });

    // Immutable ledger: debit consumer
    await tx.economyTransaction.create({
      data: {
        userId: consumerId,
        amount: -cost,
        reason: EconomyTransactionReason.DOWNLOAD_DEBIT,
        contextId: grant.id,
        contextType: 'download'
      }
    });

    // Immutable ledger: credit contributor
    await tx.economyTransaction.create({
      data: {
        userId: contribution.userId,
        amount: cost,
        reason: EconomyTransactionReason.DOWNLOAD_CREDIT,
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

    // Claw back from contributor balance and gross earnings
    await tx.user.update({
      where: { id: grant.contributorId },
      data: {
        uploaded: { decrement: grant.amountBytes },
        totalEarned: { decrement: grant.amountBytes }
      }
    });

    // Refund consumer
    await tx.user.update({
      where: { id: grant.consumerId },
      data: {
        uploaded: { increment: grant.amountBytes },
        downloaded: { decrement: grant.amountBytes }
      }
    });

    // Reversal ledger entries
    await tx.economyTransaction.create({
      data: {
        userId: grant.consumerId,
        amount: grant.amountBytes,
        reason: EconomyTransactionReason.STAFF_REVERSAL,
        contextId: grant.id,
        contextType: 'download',
        actorUserId: staffId
      }
    });
    await tx.economyTransaction.create({
      data: {
        userId: grant.contributorId,
        amount: -grant.amountBytes,
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
