/**
 * Unit tests for the ratio policy state machine.
 */

import { RatioPolicyStatus } from '@prisma/client';

const mockPrismaUser = {
  findUniqueOrThrow: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn()
};
const mockPrismaPolicy = {
  findUnique: jest.fn(),
  upsert: jest.fn(),
  update: jest.fn()
};
const mockTransaction = jest.fn((ops: unknown[]) => Promise.all(ops));

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: mockPrismaUser,
    ratioPolicyState: mockPrismaPolicy,
    $transaction: mockTransaction
  }
}));

jest.mock('./ratio', () => ({
  getRatioStats: jest.fn()
}));

jest.mock('./logging', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })
}));

import { evaluateRatioPolicy, overridePolicyStatus } from './ratioPolicy';
import { getRatioStats } from './ratio';

const mockGetRatioStats = getRatioStats as jest.MockedFunction<
  typeof getRatioStats
>;

const GiB = BigInt(1024 ** 3);

const makeStats = (overrides = {}) => ({
  ratio: 0.8,
  contributed: '0',
  consumed: '0',
  bracket: { label: '5–10 GiB', maxRequired: 0.15, minRequired: 0 },
  eligibleContributionBytes: '0',
  contributionCoverage: 0,
  requiredRatio: 0.15,
  meetsRequirement: true,
  ...overrides
});

const makeState = (overrides = {}) => ({
  userId: 1,
  status: RatioPolicyStatus.OK,
  watchStartedAt: null,
  watchExpiresAt: null,
  consumedAtWatchStart: null,
  leechDisabledAt: null,
  lastEvaluatedAt: new Date(),
  ...overrides
});

// ─── evaluateRatioPolicy ──────────────────────────────────────────────────────

describe('evaluateRatioPolicy', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockTransaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  });

  it('OK + meets requirement: only refreshes lastEvaluatedAt', async () => {
    mockGetRatioStats.mockResolvedValue(makeStats({ meetsRequirement: true }));
    mockPrismaUser.findUniqueOrThrow.mockResolvedValue({
      consumed: 7n * GiB
    });
    mockPrismaPolicy.upsert.mockResolvedValue(makeState());

    await evaluateRatioPolicy(1);

    expect(mockPrismaPolicy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastEvaluatedAt: expect.any(Date) })
      })
    );
    expect(mockPrismaUser.update).not.toHaveBeenCalled();
  });

  it('OK + fails requirement: transitions to WATCH', async () => {
    mockGetRatioStats.mockResolvedValue(
      makeStats({ meetsRequirement: false, requiredRatio: 0.15 })
    );
    mockPrismaUser.findUniqueOrThrow.mockResolvedValue({
      consumed: 7n * GiB
    });
    mockPrismaPolicy.upsert.mockResolvedValue(makeState());

    await evaluateRatioPolicy(1);

    expect(mockPrismaPolicy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: RatioPolicyStatus.WATCH,
          watchStartedAt: expect.any(Date),
          watchExpiresAt: expect.any(Date),
          consumedAtWatchStart: 7n * GiB
        })
      })
    );
  });

  it('WATCH + ratio restored: transitions to OK, re-enables canDownload', async () => {
    mockGetRatioStats.mockResolvedValue(makeStats({ meetsRequirement: true }));
    mockPrismaUser.findUniqueOrThrow.mockResolvedValue({
      consumed: 9n * GiB
    });
    mockPrismaPolicy.upsert.mockResolvedValue(
      makeState({
        status: RatioPolicyStatus.WATCH,
        watchExpiresAt: new Date(Date.now() + 86400000),
        consumedAtWatchStart: 7n * GiB
      })
    );
    mockPrismaPolicy.update.mockResolvedValue({});
    mockPrismaUser.update.mockResolvedValue({});

    await evaluateRatioPolicy(1);

    expect(mockPrismaPolicy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: RatioPolicyStatus.OK })
      })
    );
    expect(mockPrismaUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { canDownload: true } })
    );
  });

  it('WATCH + 10 GiB downloaded during watch: immediate LEECH_DISABLED', async () => {
    mockGetRatioStats.mockResolvedValue(
      makeStats({ meetsRequirement: false, requiredRatio: 0.15 })
    );
    const watchStart = 5n * GiB;
    mockPrismaUser.findUniqueOrThrow.mockResolvedValue({
      consumed: watchStart + 10n * GiB
    });
    mockPrismaPolicy.upsert.mockResolvedValue(
      makeState({
        status: RatioPolicyStatus.WATCH,
        watchExpiresAt: new Date(Date.now() + 86400000),
        consumedAtWatchStart: watchStart
      })
    );
    mockPrismaPolicy.update.mockResolvedValue({});
    mockPrismaUser.update.mockResolvedValue({});

    await evaluateRatioPolicy(1);

    expect(mockPrismaPolicy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: RatioPolicyStatus.LEECH_DISABLED
        })
      })
    );
    expect(mockPrismaUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { canDownload: false } })
    );
  });

  it('WATCH + expired watch period: transitions to LEECH_DISABLED', async () => {
    mockGetRatioStats.mockResolvedValue(
      makeStats({ meetsRequirement: false, requiredRatio: 0.15 })
    );
    mockPrismaUser.findUniqueOrThrow.mockResolvedValue({
      consumed: 6n * GiB
    });
    mockPrismaPolicy.upsert.mockResolvedValue(
      makeState({
        status: RatioPolicyStatus.WATCH,
        watchExpiresAt: new Date(Date.now() - 1), // already expired
        consumedAtWatchStart: 5n * GiB // only 1 GiB during watch
      })
    );
    mockPrismaPolicy.update.mockResolvedValue({});
    mockPrismaUser.update.mockResolvedValue({});

    await evaluateRatioPolicy(1);

    expect(mockPrismaPolicy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: RatioPolicyStatus.LEECH_DISABLED
        })
      })
    );
    expect(mockPrismaUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { canDownload: false } })
    );
  });

  it('WATCH + still within window and below limit: only refreshes timestamp', async () => {
    mockGetRatioStats.mockResolvedValue(
      makeStats({ meetsRequirement: false, requiredRatio: 0.15 })
    );
    mockPrismaUser.findUniqueOrThrow.mockResolvedValue({
      consumed: 6n * GiB
    });
    mockPrismaPolicy.upsert.mockResolvedValue(
      makeState({
        status: RatioPolicyStatus.WATCH,
        watchExpiresAt: new Date(Date.now() + 86400000),
        consumedAtWatchStart: 5n * GiB // only 1 GiB during watch
      })
    );

    await evaluateRatioPolicy(1);

    expect(mockPrismaPolicy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastEvaluatedAt: expect.any(Date) })
      })
    );
    expect(mockPrismaUser.update).not.toHaveBeenCalled();
  });

  it('LEECH_DISABLED: no status change, only refreshes timestamp', async () => {
    mockGetRatioStats.mockResolvedValue(makeStats({ meetsRequirement: false }));
    mockPrismaUser.findUniqueOrThrow.mockResolvedValue({
      consumed: 50n * GiB
    });
    mockPrismaPolicy.upsert.mockResolvedValue(
      makeState({ status: RatioPolicyStatus.LEECH_DISABLED })
    );

    await evaluateRatioPolicy(1);

    expect(mockPrismaPolicy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastEvaluatedAt: expect.any(Date) })
      })
    );
    expect(mockPrismaUser.update).not.toHaveBeenCalled();
  });
});

// ─── overridePolicyStatus ─────────────────────────────────────────────────────

describe('overridePolicyStatus', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockTransaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  });

  it('throws 404 when user not found', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);
    await expect(
      overridePolicyStatus(1, RatioPolicyStatus.OK)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('sets canDownload=false when overriding to LEECH_DISABLED', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({ id: 1 });
    mockPrismaPolicy.upsert.mockResolvedValue(
      makeState({
        status: RatioPolicyStatus.LEECH_DISABLED,
        leechDisabledAt: new Date()
      })
    );
    mockPrismaUser.update.mockResolvedValue({});

    await overridePolicyStatus(1, RatioPolicyStatus.LEECH_DISABLED);

    expect(mockPrismaUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { canDownload: false } })
    );
  });

  it('sets canDownload=true when restoring to OK', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({ id: 1 });
    mockPrismaPolicy.upsert.mockResolvedValue(makeState());
    mockPrismaUser.update.mockResolvedValue({});

    await overridePolicyStatus(1, RatioPolicyStatus.OK);

    expect(mockPrismaUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { canDownload: true } })
    );
  });
});
