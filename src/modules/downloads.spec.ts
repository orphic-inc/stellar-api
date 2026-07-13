/**
 * Service-level unit tests for the downloads module.
 */

import { AppError } from '../lib/errors';
import {
  DownloadGrantStatus,
  EconomyTransactionReason,
  RatioExempt
} from '@prisma/client';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockTx = {
  contribution: { findUnique: jest.fn() },
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
    update: jest.fn()
  },
  economyTransaction: { create: jest.fn() },
  consumer: { upsert: jest.fn(), update: jest.fn() }
};

const mockEvaluateRatioPolicy = jest.fn();
const mockTransaction = jest.fn();
// The grant-time ratio gate pre-reads the contribution's exemption OUTSIDE the
// transaction (never hold a tx across a network call), so the top-level prisma mock
// needs `contribution.findUnique` in addition to `$transaction`.
const mockGateContributionFindUnique = jest.fn();

const mockCheckCanConsume = jest.fn();
const mockPushConsumptionEvent = jest.fn();

jest.mock('./ratioPolicy', () => ({
  evaluateRatioPolicy: mockEvaluateRatioPolicy
}));

jest.mock('./ledger', () => ({
  checkCanConsume: mockCheckCanConsume,
  buildConsumptionEvent: jest.fn(() => ({})),
  pushConsumptionEvent: mockPushConsumptionEvent
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: mockTransaction,
    contribution: { findUnique: mockGateContributionFindUnique }
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
  // Gate defaults: non-exempt contribution + korin unreachable (null ⇒ fail open),
  // so the gate is transparent for the existing grant/reverse cases.
  mockGateContributionFindUnique.mockResolvedValue({
    ratioExempt: RatioExempt.NONE
  });
  mockCheckCanConsume.mockReset().mockResolvedValue(null);
  mockPushConsumptionEvent.mockReset().mockResolvedValue(true);
});

// ─── grantDownloadAccess ───────────────────────────────────────────────────────

describe('grantDownloadAccess', () => {
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
      makeUser({ contributed: BigInt(1000) })
    );
    mockTx.downloadAccessGrant.findFirst.mockResolvedValue(null);
    await expect(grantDownloadAccess(7, 5)).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('throws 409 on CAS failure (concurrent balance drain)', async () => {
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
        data: expect.objectContaining({
          contributed: { increment: cost },
          ratio: expect.any(Number)
        })
      })
    );
  });

  it('debits consumer, credits contributor, creates grant and 2 ledger rows on success', async () => {
    const cost = BigInt('209715200');
    const grant = makeGrant();
    mockTx.contribution.findUnique.mockResolvedValue(makeContribution());
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
        where: expect.objectContaining({
          id: 7,
          consumed: { lte: expect.anything() }
        }),
        data: expect.objectContaining({
          consumed: { increment: cost },
          ratio: expect.any(Number)
        })
      })
    );
    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99 },
        data: {
          contributed: { increment: cost },
          ratio: expect.any(Number)
        }
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

// ─── grant-time canConsume gate (ADR-0016) ──────────────────────────────────────

describe('grantDownloadAccess — ratio gate', () => {
  it('blocks with 403 before opening the transaction when korin says allow:false', async () => {
    mockCheckCanConsume.mockResolvedValue({
      allow: false,
      reason: 'LEECH_DISABLED'
    });

    await expect(grantDownloadAccess(7, 5)).rejects.toMatchObject({
      statusCode: 403
    });
    // Gate short-circuits: the grant transaction never runs.
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('fails open (proceeds) when korin is unreachable (null verdict)', async () => {
    mockCheckCanConsume.mockResolvedValue(null);
    mockTx.contribution.findUnique.mockResolvedValue(makeContribution());
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    mockTx.downloadAccessGrant.findFirst.mockResolvedValue(null);
    mockTx.user.updateMany.mockResolvedValue({ count: 1 });
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.user.findUniqueOrThrow.mockResolvedValue({
      consumed: BigInt(0),
      contributed: BigInt('2000000000')
    });
    mockTx.downloadAccessGrant.create.mockResolvedValue(makeGrant());
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.consumer.upsert.mockResolvedValue({ id: 1 });
    mockTx.consumer.update.mockResolvedValue(undefined);

    await expect(grantDownloadAccess(7, 5)).resolves.toMatchObject({
      status: DownloadGrantStatus.COMPLETED
    });
  });

  it('skips the gate entirely for an exempt contribution', async () => {
    // Even a hostile allow:false must not touch an exempt grant.
    mockGateContributionFindUnique.mockResolvedValue({
      ratioExempt: RatioExempt.FREEPASS
    });
    mockCheckCanConsume.mockResolvedValue({ allow: false });
    mockTx.contribution.findUnique.mockResolvedValue(
      makeContribution({ ratioExempt: RatioExempt.FREEPASS })
    );
    mockTx.user.findUnique.mockResolvedValue(makeUser());
    mockTx.downloadAccessGrant.findFirst.mockResolvedValue(null);
    mockTx.user.findUniqueOrThrow.mockResolvedValue({
      consumed: BigInt(0),
      contributed: BigInt('2000000000')
    });
    mockTx.downloadAccessGrant.create.mockResolvedValue(
      makeGrant({ ratioExempt: RatioExempt.FREEPASS })
    );
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.consumer.upsert.mockResolvedValue({ id: 1 });
    mockTx.consumer.update.mockResolvedValue(undefined);

    await grantDownloadAccess(7, 5);

    expect(mockCheckCanConsume).not.toHaveBeenCalled();
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

  it('reverses ledger, updates balances with ratio, marks grant REVERSED', async () => {
    const grant = makeGrant();
    mockTx.downloadAccessGrant.findUnique.mockResolvedValue(grant);
    // findUniqueOrThrow called for consumer then contributor
    mockTx.user.findUniqueOrThrow
      .mockResolvedValueOnce({
        consumed: grant.amountBytes,
        contributed: BigInt('2000000000')
      }) // consumer
      .mockResolvedValueOnce({
        consumed: 0n,
        contributed: grant.amountBytes
      }); // contributor
    mockTx.user.update.mockResolvedValue(undefined);
    mockTx.economyTransaction.create.mockResolvedValue(undefined);
    mockTx.downloadAccessGrant.update.mockResolvedValue({
      ...grant,
      status: DownloadGrantStatus.REVERSED,
      reversedById: 99
    });

    const result = await reverseDownloadAccess(99, 1, 'Dead link');

    expect(mockTx.user.update).toHaveBeenCalledTimes(2);
    // contributor deducted (contributed balance + ratio)
    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: grant.contributorId },
        data: expect.objectContaining({
          contributed: { decrement: grant.amountBytes },
          ratio: expect.any(Number)
        })
      })
    );
    // consumer refunded (consumed decrements + ratio; contributed unchanged)
    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: grant.consumerId },
        data: expect.objectContaining({
          consumed: { decrement: grant.amountBytes },
          ratio: expect.any(Number)
        })
      })
    );
    expect(mockTx.economyTransaction.create).toHaveBeenCalledTimes(2);
    type TxCall = [{ data: Record<string, unknown> }];
    const ledgerCalls = (
      mockTx.economyTransaction.create.mock.calls as TxCall[]
    ).map(([arg]) => arg.data);
    expect(ledgerCalls.every((r) => r.reason === 'STAFF_REVERSAL')).toBe(true);
    expect(ledgerCalls.every((r) => r.actorUserId === 99)).toBe(true);
    expect(result.status).toBe(DownloadGrantStatus.REVERSED);
  });
});
