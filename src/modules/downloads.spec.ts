/**
 * Service-level unit tests for the downloads module.
 */

import {
  DownloadGrantStatus,
  EconomyTransactionReason,
  RatioExempt
} from '@prisma/client';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockTx = {
  contribution: { findFirst: jest.fn() },
  user: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn()
  },
  downloadAccessGrant: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn()
  },
  economyTransaction: { create: jest.fn() },
  consumer: { upsert: jest.fn(), update: jest.fn() }
};

const mockEvaluateRatioPolicy = jest.fn();
const mockTransaction = jest.fn();

jest.mock('./ratioPolicy', () => ({
  evaluateRatioPolicy: mockEvaluateRatioPolicy
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: mockTransaction
  }
}));

import { grantDownloadAccess, reverseDownloadAccess } from './downloads';
import { contributionVisibleTo } from './communityAccess';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeContribution = (overrides = {}) => ({
  id: 5,
  userId: 99,
  downloadUrl: 'https://example.com/file.zip',
  sizeInBytes: 209715200,
  approvedAccountingBytes: null,
  ratioExempt: RatioExempt.NONE,
  ...overrides
});

const makeUser = (overrides = {}) => ({
  canDownload: true,
  contributed: BigInt('1073741824'),
  consumed: BigInt('0'),
  ...overrides
});

const makeGrant = (overrides = {}) => ({
  id: 1,
  consumerId: 7,
  contributorId: 99,
  contributionId: 5,
  amountBytes: BigInt('209715200'),
  ratioExempt: RatioExempt.NONE,
  status: DownloadGrantStatus.COMPLETED,
  idempotencyKey: null,
  reversedAt: null,
  reversalReason: null,
  reversedById: null,
  createdAt: new Date(),
  ...overrides
});

beforeEach(() => {
  mockTransaction.mockImplementation(
    (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)
  );
  mockEvaluateRatioPolicy.mockResolvedValue(undefined);
});

// ─── grantDownloadAccess ───────────────────────────────────────────────────────

describe('grantDownloadAccess', () => {
  // #778: a contribution the consumer cannot see is found exactly as a
  // missing one is: 404, before any balance check, debit or grant.
  it('answers 404 for a missing or hidden contribution, and writes nothing', async () => {
    mockTx.contribution.findFirst.mockResolvedValue(null);
    await expect(grantDownloadAccess(7, 5)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Contribution not found'
    });
    expect(mockTx.contribution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5, ...contributionVisibleTo(7) }
      })
    );
    expect(mockTx.user.updateMany).not.toHaveBeenCalled();
    expect(mockTx.downloadAccessGrant.create).not.toHaveBeenCalled();
  });

  it('throws 403 when canDownload is false', async () => {
    mockTx.contribution.findFirst.mockResolvedValue(makeContribution());
    mockTx.user.findUnique.mockResolvedValue(makeUser({ canDownload: false }));
    await expect(grantDownloadAccess(7, 5)).rejects.toMatchObject({
      statusCode: 403
    });
  });

  it('throws 400 when no accounting size is available', async () => {
    mockTx.contribution.findFirst.mockResolvedValue(
      makeContribution({ sizeInBytes: null, approvedAccountingBytes: null })
    );
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    await expect(grantDownloadAccess(7, 5)).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('throws 400 when balance is insufficient', async () => {
    mockTx.contribution.findFirst.mockResolvedValue(makeContribution());
    mockTx.user.findUnique.mockResolvedValue(
      makeUser({ contributed: BigInt(1000) })
    );
    mockTx.downloadAccessGrant.findFirst.mockResolvedValue(null);
    await expect(grantDownloadAccess(7, 5)).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('throws 409 on CAS failure (concurrent balance drain)', async () => {
    mockTx.contribution.findFirst.mockResolvedValue(makeContribution());
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    mockTx.downloadAccessGrant.findFirst.mockResolvedValue(null);
    mockTx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(grantDownloadAccess(7, 5)).rejects.toMatchObject({
      statusCode: 409
    });
  });

  // #761: two first downloads by one member can both insert the Consumer row.
  // The guard answers 409; the transaction, debit included, rolls back.
  it('throws 409 when a concurrent first download inserted the consumer row', async () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    mockTx.contribution.findFirst.mockResolvedValue(makeContribution());
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    mockTx.downloadAccessGrant.findFirst.mockResolvedValue(null);
    mockTx.user.updateMany.mockResolvedValue({ count: 1 });
    mockTx.downloadAccessGrant.create.mockResolvedValue(makeGrant());
    mockTx.consumer.upsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('boom', {
        code: 'P2002',
        clientVersion: 'test'
      })
    );

    await expect(grantDownloadAccess(7, 5)).rejects.toEqual(
      expect.objectContaining({ statusCode: 409 })
    );
  });

  it('reuses existing grant within idempotency window', async () => {
    const existing = makeGrant();
    mockTx.contribution.findFirst.mockResolvedValue(makeContribution());
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
    mockTx.contribution.findFirst.mockResolvedValue(
      makeContribution({
        approvedAccountingBytes: cost,
        sizeInBytes: 209715200
      })
    );
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    mockTx.user.findUniqueOrThrow.mockResolvedValue({
      consumed: BigInt(0),
      contributed: cost
    });
    mockTx.downloadAccessGrant.findFirst.mockResolvedValue(null);
    mockTx.user.updateMany.mockResolvedValue({ count: 1 });
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.downloadAccessGrant.create.mockResolvedValue(
      makeGrant({ amountBytes: cost })
    );
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.consumer.upsert.mockResolvedValue({ id: 1 });
    mockTx.consumer.update.mockResolvedValue(undefined);

    await grantDownloadAccess(7, 5);

    expect(mockTx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consumed: { increment: cost } })
      })
    );
    expect(mockTx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ contributed: { decrement: cost } })
      })
    );
    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { contributed: { increment: cost } }
      })
    );
  });

  it('debits consumer, credits contributor, creates grant and 2 ledger rows on success', async () => {
    const cost = BigInt('209715200');
    const grant = makeGrant();
    mockTx.contribution.findFirst.mockResolvedValue(makeContribution());
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    mockTx.user.findUniqueOrThrow.mockResolvedValue({
      consumed: BigInt(0),
      contributed: BigInt('2000000000')
    });
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
        // Snapshot CAS (#760): both columns as read, so a concurrent
        // claw-back of `contributed` also fails the debit.
        where: {
          id: 7,
          consumed: makeUser().consumed,
          contributed: makeUser().contributed
        },
        data: { consumed: { increment: cost } }
      })
    );
    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99 },
        data: { contributed: { increment: cost } }
      })
    );
    expect(mockTx.economyTransaction.create).toHaveBeenCalledTimes(2);
    type TxCall = [{ data: Record<string, unknown> }];
    const [debitCall, creditCall] = (
      mockTx.economyTransaction.create.mock.calls as TxCall[]
    ).map(([arg]) => arg.data);
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

  // #760: the claim is the first write. A concurrent reversal that passed the
  // pre-check loses here and writes nothing: no balances, no ledger rows.
  it('throws 409 and writes nothing when a concurrent reversal claimed the grant', async () => {
    mockTx.downloadAccessGrant.findUnique.mockResolvedValue(makeGrant());
    mockTx.downloadAccessGrant.updateMany.mockResolvedValue({ count: 0 });
    await expect(reverseDownloadAccess(99, 1, 'reason')).rejects.toMatchObject({
      statusCode: 409
    });
    expect(mockTx.user.updateMany).not.toHaveBeenCalled();
    expect(mockTx.economyTransaction.create).not.toHaveBeenCalled();
  });

  it('claims the grant before moving any money', async () => {
    const grant = makeGrant();
    mockTx.downloadAccessGrant.findUnique.mockResolvedValue(grant);
    mockTx.downloadAccessGrant.updateMany.mockResolvedValue({ count: 1 });
    mockTx.user.updateMany.mockResolvedValue({ count: 1 });
    mockTx.economyTransaction.create.mockResolvedValue(undefined);

    await reverseDownloadAccess(99, 1, 'Dead link');

    expect(mockTx.downloadAccessGrant.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: DownloadGrantStatus.COMPLETED },
      data: {
        status: DownloadGrantStatus.REVERSED,
        reversedAt: expect.any(Date),
        reversalReason: 'Dead link',
        reversedById: 99
      }
    });
    const claimOrder =
      mockTx.downloadAccessGrant.updateMany.mock.invocationCallOrder[0];
    const moneyOrders = [
      ...mockTx.user.updateMany.mock.invocationCallOrder,
      ...mockTx.economyTransaction.create.mock.invocationCallOrder
    ];
    expect(moneyOrders.every((o) => o > claimOrder)).toBe(true);
  });

  it('decrements both balances rather than writing values it read, and posts the ledger pair', async () => {
    const grant = makeGrant();
    mockTx.downloadAccessGrant.findUnique.mockResolvedValue(grant);
    mockTx.downloadAccessGrant.updateMany.mockResolvedValue({ count: 1 });
    mockTx.user.updateMany.mockResolvedValue({ count: 1 });
    mockTx.economyTransaction.create.mockResolvedValue(undefined);

    const result = await reverseDownloadAccess(99, 1, 'Dead link');

    // No balance read: a read-then-write would overwrite a concurrent grant.
    expect(mockTx.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mockTx.user.update).not.toHaveBeenCalled();
    expect(mockTx.user.updateMany).toHaveBeenCalledWith({
      where: { id: grant.consumerId, consumed: { gte: grant.amountBytes } },
      data: { consumed: { decrement: grant.amountBytes } }
    });
    expect(mockTx.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: grant.contributorId,
        contributed: { gte: grant.amountBytes }
      },
      data: { contributed: { decrement: grant.amountBytes } }
    });
    type TxCall = [{ data: Record<string, unknown> }];
    const ledgerCalls = (
      mockTx.economyTransaction.create.mock.calls as TxCall[]
    ).map(([arg]) => arg.data);
    expect(ledgerCalls).toEqual([
      expect.objectContaining({
        userId: grant.consumerId,
        amount: grant.amountBytes,
        reason: EconomyTransactionReason.STAFF_REVERSAL,
        actorUserId: 99
      }),
      expect.objectContaining({
        userId: grant.contributorId,
        amount: -grant.amountBytes,
        reason: EconomyTransactionReason.STAFF_REVERSAL,
        actorUserId: 99
      })
    ]);
    expect(result).toEqual({
      grantId: 1,
      status: DownloadGrantStatus.REVERSED
    });
  });

  it('moves no balance on a side the grant suppressed (Neutralpass)', async () => {
    mockTx.downloadAccessGrant.findUnique.mockResolvedValue(
      makeGrant({ ratioExempt: RatioExempt.NEUTRALPASS })
    );
    mockTx.downloadAccessGrant.updateMany.mockResolvedValue({ count: 1 });
    mockTx.economyTransaction.create.mockResolvedValue(undefined);

    await reverseDownloadAccess(99, 1);

    expect(mockTx.user.updateMany).not.toHaveBeenCalled();
    expect(mockTx.economyTransaction.create).toHaveBeenCalledTimes(2);
  });
});
