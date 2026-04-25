/**
 * Service-level unit tests for the downloads module.
 */

import { AppError } from '../lib/errors';
import { DownloadGrantStatus, EconomyTransactionReason } from '@prisma/client';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockTx = {
  contribution: { findUnique: jest.fn() },
  user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  downloadAccessGrant: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  economyTransaction: { create: jest.fn() },
  consumer: { upsert: jest.fn(), update: jest.fn() }
};

jest.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) =>
      cb(mockTx)
    )
  }
}));

import { grantDownloadAccess, reverseDownloadAccess } from './downloads';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeContribution = (overrides = {}) => ({
  id: 5,
  userId: 99,
  downloadUrl: 'https://example.com/file.zip',
  sizeInBytes: 209715200,
  approvedAccountingBytes: null,
  ...overrides
});

const makeUser = (overrides = {}) => ({
  canDownload: true,
  uploaded: BigInt('1073741824'),
  ...overrides
});

const makeGrant = (overrides = {}) => ({
  id: 1,
  consumerId: 7,
  contributorId: 99,
  contributionId: 5,
  amountBytes: BigInt('209715200'),
  status: DownloadGrantStatus.COMPLETED,
  idempotencyKey: null,
  reversedAt: null,
  reversalReason: null,
  reversedById: null,
  createdAt: new Date(),
  ...overrides
});

// ─── grantDownloadAccess ───────────────────────────────────────────────────────

describe('grantDownloadAccess', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 when contribution not found', async () => {
    mockTx.contribution.findUnique.mockResolvedValue(null);
    await expect(grantDownloadAccess(7, 5)).rejects.toThrow(AppError);
  });

  it('throws 403 when canDownload is false', async () => {
    mockTx.contribution.findUnique.mockResolvedValue(makeContribution());
    mockTx.user.findUnique.mockResolvedValue(makeUser({ canDownload: false }));
    await expect(grantDownloadAccess(7, 5)).rejects.toMatchObject({
      statusCode: 403
    });
  });

  it('throws 400 when no accounting size is available', async () => {
    mockTx.contribution.findUnique.mockResolvedValue(
      makeContribution({ sizeInBytes: null, approvedAccountingBytes: null })
    );
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    await expect(grantDownloadAccess(7, 5)).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('throws 400 when balance is insufficient', async () => {
    mockTx.contribution.findUnique.mockResolvedValue(makeContribution());
    mockTx.user.findUnique.mockResolvedValue(
      makeUser({ uploaded: BigInt(1000) })
    );
    mockTx.downloadAccessGrant.findFirst.mockResolvedValue(null);
    await expect(grantDownloadAccess(7, 5)).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('throws 409 on CAS failure (concurrent balance change)', async () => {
    mockTx.contribution.findUnique.mockResolvedValue(makeContribution());
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    mockTx.downloadAccessGrant.findFirst.mockResolvedValue(null);
    mockTx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(grantDownloadAccess(7, 5)).rejects.toMatchObject({
      statusCode: 409
    });
  });

  it('reuses existing grant within idempotency window', async () => {
    const existing = makeGrant();
    mockTx.contribution.findUnique.mockResolvedValue(makeContribution());
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    mockTx.downloadAccessGrant.findFirst.mockResolvedValue(existing);

    const result = await grantDownloadAccess(7, 5);

    expect(result.grantId).toBe(existing.id);
    expect(result.amountBytes).toBe(existing.amountBytes.toString());
    expect(mockTx.user.updateMany).not.toHaveBeenCalled();
    expect(mockTx.downloadAccessGrant.create).not.toHaveBeenCalled();
  });

  it('uses approvedAccountingBytes over sizeInBytes when both present', async () => {
    const cost = BigInt('524288000'); // 500 MiB
    mockTx.contribution.findUnique.mockResolvedValue(
      makeContribution({ approvedAccountingBytes: cost, sizeInBytes: 209715200 })
    );
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    mockTx.downloadAccessGrant.findFirst.mockResolvedValue(null);
    mockTx.user.updateMany.mockResolvedValue({ count: 1 });
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.downloadAccessGrant.create.mockResolvedValue(makeGrant({ amountBytes: cost }));
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.consumer.upsert.mockResolvedValue({ id: 1 });
    mockTx.consumer.update.mockResolvedValue(undefined);

    await grantDownloadAccess(7, 5);

    expect(mockTx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ uploaded: { decrement: cost } })
      })
    );
    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalEarned: { increment: cost } })
      })
    );
  });

  it('debits consumer, credits contributor, creates grant and 2 ledger rows on success', async () => {
    const cost = BigInt('209715200');
    const grant = makeGrant();
    mockTx.contribution.findUnique.mockResolvedValue(makeContribution());
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    mockTx.downloadAccessGrant.findFirst.mockResolvedValue(null);
    mockTx.user.updateMany.mockResolvedValue({ count: 1 });
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.downloadAccessGrant.create.mockResolvedValue(grant);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.consumer.upsert.mockResolvedValue({ id: 1 });
    mockTx.consumer.update.mockResolvedValue(undefined);

    const result = await grantDownloadAccess(7, 5);

    expect(mockTx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 7, uploaded: { gte: cost } }),
        data: expect.objectContaining({
          uploaded: { decrement: cost },
          downloaded: { increment: cost }
        })
      })
    );
    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99 },
        data: {
          uploaded: { increment: cost },
          totalEarned: { increment: cost }
        }
      })
    );
    expect(mockTx.economyTransaction.create).toHaveBeenCalledTimes(2);
    const [debitCall, creditCall] = (
      mockTx.economyTransaction.create.mock.calls as any[]
    ).map(([arg]: [any]) => arg.data);
    expect(debitCall).toMatchObject({
      userId: 7,
      reason: EconomyTransactionReason.DOWNLOAD_DEBIT
    });
    expect(creditCall).toMatchObject({
      userId: 99,
      reason: EconomyTransactionReason.DOWNLOAD_CREDIT
    });
    expect(result.downloadUrl).toBe('https://example.com/file.zip');
    expect(result.amountBytes).toBe(cost.toString());
  });
});

// ─── reverseDownloadAccess ─────────────────────────────────────────────────────

describe('reverseDownloadAccess', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 when grant not found', async () => {
    mockTx.downloadAccessGrant.findUnique.mockResolvedValue(null);
    await expect(reverseDownloadAccess(99, 1, 'reason')).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('throws 409 when grant is already REVERSED', async () => {
    mockTx.downloadAccessGrant.findUnique.mockResolvedValue(
      makeGrant({ status: DownloadGrantStatus.REVERSED })
    );
    await expect(reverseDownloadAccess(99, 1, 'reason')).rejects.toMatchObject({
      statusCode: 409
    });
  });

  it('reverses ledger, updates balances, marks grant REVERSED', async () => {
    const grant = makeGrant();
    mockTx.downloadAccessGrant.findUnique.mockResolvedValue(grant);
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.downloadAccessGrant.update.mockResolvedValue({
      ...grant,
      status: DownloadGrantStatus.REVERSED,
      reversedById: 99
    });

    const result = await reverseDownloadAccess(99, 1, 'Dead link');

    expect(mockTx.user.update).toHaveBeenCalledTimes(2);
    // contributor deducted (balance + gross earnings)
    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: grant.contributorId },
        data: {
          uploaded: { decrement: grant.amountBytes },
          totalEarned: { decrement: grant.amountBytes }
        }
      })
    );
    // consumer refunded
    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: grant.consumerId },
        data: {
          uploaded: { increment: grant.amountBytes },
          downloaded: { decrement: grant.amountBytes }
        }
      })
    );
    expect(mockTx.economyTransaction.create).toHaveBeenCalledTimes(2);
    const ledgerCalls = (
      mockTx.economyTransaction.create.mock.calls as any[]
    ).map(([arg]: [any]) => arg.data);
    expect(ledgerCalls.every((r: any) => r.reason === 'STAFF_REVERSAL')).toBe(
      true
    );
    expect(ledgerCalls.every((r: any) => r.actorUserId === 99)).toBe(true);
    expect(result.status).toBe(DownloadGrantStatus.REVERSED);
  });
});
