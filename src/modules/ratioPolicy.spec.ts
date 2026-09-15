/**
 * Unit tests for the ratio policy state machine.
 */

import { RatioPolicyStatus, RatioDisableCause } from '@prisma/client';

const mockPrismaUser = {
  findUniqueOrThrow: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn()
};
const mockPrismaPolicy = {
  findUnique: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
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

jest.mock('../lib/audit', () => ({ audit: jest.fn() }));
jest.mock('./pm', () => ({ sendSystemMessage: jest.fn() }));

import {
  evaluateRatioPolicy,
  listRatioWatch,
  overridePolicyStatus
} from './ratioPolicy';
import { getRatioStats } from './ratio';
import { audit } from '../lib/audit';
import { sendSystemMessage } from './pm';

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
  downloadDisabledAt: null,
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

  it('WATCH + 10 GiB downloaded during watch: immediate DOWNLOAD_DISABLED', async () => {
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
          status: RatioPolicyStatus.DOWNLOAD_DISABLED,
          disabledCause: RatioDisableCause.RATIO
        })
      })
    );
    expect(mockPrismaUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { canDownload: false } })
    );
  });

  it('WATCH + expired watch period: transitions to DOWNLOAD_DISABLED', async () => {
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
          status: RatioPolicyStatus.DOWNLOAD_DISABLED,
          disabledCause: RatioDisableCause.RATIO
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

  it('DOWNLOAD_DISABLED: no status change, only refreshes timestamp', async () => {
    mockGetRatioStats.mockResolvedValue(makeStats({ meetsRequirement: false }));
    mockPrismaUser.findUniqueOrThrow.mockResolvedValue({
      consumed: 50n * GiB
    });
    mockPrismaPolicy.upsert.mockResolvedValue(
      makeState({ status: RatioPolicyStatus.DOWNLOAD_DISABLED })
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
  const mockAudit = audit as jest.Mock;
  const mockPm = sendSystemMessage as jest.Mock;
  const override = (status: RatioPolicyStatus, message?: string) =>
    overridePolicyStatus(7, 1, { status, reason: 'appeal upheld', message });

  beforeEach(() => {
    jest.resetAllMocks();
    // The override is an interactive transaction; run it against the mocks.
    mockTransaction.mockImplementation(((cb: (tx: unknown) => unknown) =>
      cb({
        user: mockPrismaUser,
        ratioPolicyState: mockPrismaPolicy
      })) as never);
    mockPrismaUser.findUnique.mockResolvedValue({ consumed: 12n * GiB });
    mockPrismaPolicy.findUnique.mockResolvedValue(null);
    mockPrismaPolicy.upsert.mockImplementation(
      async ({ create }: { create: Record<string, unknown> }) =>
        makeState(create)
    );
    mockPrismaUser.update.mockResolvedValue({});
    mockPm.mockResolvedValue({ ok: true });
  });

  const written = () =>
    (
      mockPrismaPolicy.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      }
    ).update;

  it('throws 404 when user not found, writing nothing', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);
    await expect(override(RatioPolicyStatus.OK)).rejects.toMatchObject({
      statusCode: 404
    });
    expect(mockPrismaPolicy.upsert).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('disables downloads with cause STAFF', async () => {
    const view = await override(RatioPolicyStatus.DOWNLOAD_DISABLED);

    expect(written()).toMatchObject({
      status: RatioPolicyStatus.DOWNLOAD_DISABLED,
      disabledCause: RatioDisableCause.STAFF,
      watchStartedAt: null
    });
    expect(mockPrismaUser.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { canDownload: false }
    });
    expect(view.disabledCause).toBe(RatioDisableCause.STAFF);
  });

  it.each([RatioPolicyStatus.OK, RatioPolicyStatus.WATCH])(
    'clears the cause and restores downloads when set to %s',
    async (status) => {
      mockPrismaPolicy.findUnique.mockResolvedValue({
        status: RatioPolicyStatus.DOWNLOAD_DISABLED,
        disabledCause: RatioDisableCause.RATIO
      });

      await override(status);

      expect(written()).toMatchObject({ status, disabledCause: null });
      expect(mockPrismaUser.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { canDownload: true }
      });
    }
  );

  it("starts a staff watch from the member's current consumed, so the 10 GiB rule applies", async () => {
    await override(RatioPolicyStatus.WATCH);

    expect(written()).toMatchObject({
      status: RatioPolicyStatus.WATCH,
      consumedAtWatchStart: 12n * GiB,
      watchStartedAt: expect.any(Date),
      watchExpiresAt: expect.any(Date)
    });
  });

  it('audits from and to, with the reason, as the acting staff member', async () => {
    mockPrismaPolicy.findUnique.mockResolvedValue({
      status: RatioPolicyStatus.DOWNLOAD_DISABLED,
      disabledCause: RatioDisableCause.RATIO
    });

    await override(RatioPolicyStatus.DOWNLOAD_DISABLED);

    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      7,
      'ratioPolicy.override',
      'User',
      1,
      {
        from: RatioPolicyStatus.DOWNLOAD_DISABLED,
        fromCause: RatioDisableCause.RATIO,
        to: RatioPolicyStatus.DOWNLOAD_DISABLED,
        toCause: RatioDisableCause.STAFF,
        reason: 'appeal upheld',
        messaged: false
      }
    );
    expect(mockPm).not.toHaveBeenCalled();
  });

  it('PMs the member only when staff write a message, pointing to Staff PM', async () => {
    await override(RatioPolicyStatus.DOWNLOAD_DISABLED, 'Shared your account.');

    expect(mockPm).toHaveBeenCalledWith(
      1,
      'Your downloads have been disabled',
      'Shared your account.\n\nIf you have questions, contact staff through Staff PM: /inbox/staff'
    );
    expect(mockAudit.mock.calls[0][5]).toMatchObject({ messaged: true });
  });
});

// ─── listRatioWatch ───────────────────────────────────────────────────────────

describe('listRatioWatch', () => {
  it('selects the documented fields, disabledCause included, and nothing else (#646)', async () => {
    jest.resetAllMocks();
    mockPrismaPolicy.findMany.mockResolvedValue([]);
    mockPrismaPolicy.count.mockResolvedValue(0);

    await listRatioWatch({ page: 1, limit: 25, skip: 0 });

    const args = mockPrismaPolicy.findMany.mock.calls[0][0];
    expect(args).not.toHaveProperty('include');
    expect(Object.keys(args.select).sort()).toEqual([
      'disabledCause',
      'downloadDisabledAt',
      'lastEvaluatedAt',
      'status',
      'user',
      'userId',
      'watchExpiresAt',
      'watchStartedAt'
    ]);
    expect(args.where).toEqual({
      status: {
        in: [RatioPolicyStatus.WATCH, RatioPolicyStatus.DOWNLOAD_DISABLED]
      }
    });
  });
});
