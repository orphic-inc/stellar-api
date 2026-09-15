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
  update: jest.fn(),
  updateMany: jest.fn()
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
jest.mock('./rankProgressionJob', () => ({
  resolveSystemActorId: jest.fn()
}));

import {
  applyRatioRules,
  evaluateRatioPolicy,
  listRatioWatch,
  overridePolicyStatus
} from './ratioPolicy';
import { resolveSystemActorId } from './rankProgressionJob';
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
  disabledCause: null,
  lastEvaluatedAt: new Date(),
  ...overrides
});

// ─── evaluateRatioPolicy ──────────────────────────────────────────────────────

describe('applyRatioRules', () => {
  const mockAudit = audit as jest.Mock;
  const mockPm = sendSystemMessage as jest.Mock;
  const SYSTEM_ID = 99;

  beforeEach(() => {
    jest.resetAllMocks();
    mockTransaction.mockImplementation(((cb: (tx: unknown) => unknown) =>
      cb({
        user: mockPrismaUser,
        ratioPolicyState: mockPrismaPolicy
      })) as never);
    (resolveSystemActorId as jest.Mock).mockResolvedValue(SYSTEM_ID);
    mockPrismaUser.findUniqueOrThrow.mockResolvedValue({ consumed: 20n * GiB });
    mockPrismaPolicy.updateMany.mockResolvedValue({ count: 1 });
    mockPrismaUser.update.mockResolvedValue({});
    mockPm.mockResolvedValue({ ok: true });
  });

  const short = () =>
    mockGetRatioStats.mockResolvedValue(
      makeStats({ ratio: 0.1, requiredRatio: 0.3, meetsRequirement: false })
    );
  const meets = () =>
    mockGetRatioStats.mockResolvedValue(
      makeStats({ ratio: 0.5, requiredRatio: 0.3, meetsRequirement: true })
    );

  it('makes no transition when none applies: refreshes lastEvaluatedAt only', async () => {
    meets();
    mockPrismaPolicy.upsert.mockResolvedValue(makeState());

    expect(await evaluateRatioPolicy(1)).toBeUndefined();

    expect(mockPrismaPolicy.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrismaPolicy.updateMany).toHaveBeenCalledWith({
      where: { userId: 1 },
      data: { lastEvaluatedAt: expect.any(Date) }
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockPm).not.toHaveBeenCalled();
  });

  const STARTED_AT = new Date('2026-09-01T00:00:00Z');
  /** A short member whose watch has run out: the rules disable them. */
  const expiredWatch = async () => {
    short();
    mockPrismaPolicy.upsert.mockResolvedValue(
      makeState({
        status: RatioPolicyStatus.WATCH,
        watchStartedAt: STARTED_AT,
        watchExpiresAt: new Date(Date.now() - 1),
        consumedAtWatchStart: 19n * GiB
      })
    );
    expect(await applyRatioRules(1, 'sweep')).toEqual({
      kind: 'download_disabled',
      trigger: 'watch_expired'
    });
  };

  it('claims a transition on the row as it was read', async () => {
    await expiredWatch();

    expect(mockPrismaPolicy.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 1,
        status: RatioPolicyStatus.WATCH,
        disabledCause: null,
        watchStartedAt: STARTED_AT
      },
      data: expect.objectContaining({
        status: RatioPolicyStatus.DOWNLOAD_DISABLED,
        disabledCause: RatioDisableCause.RATIO
      })
    });
    expect(mockPrismaUser.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { canDownload: false }
    });
  });

  it('audits the claimed transition as the SysOp, with the numbers, then PMs it', async () => {
    await expiredWatch();

    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      SYSTEM_ID,
      'ratioPolicy.download_disabled',
      'User',
      1,
      {
        from: RatioPolicyStatus.WATCH,
        fromCause: null,
        to: RatioPolicyStatus.DOWNLOAD_DISABLED,
        toCause: RatioDisableCause.RATIO,
        ratio: 0.1,
        requiredRatio: 0.3,
        by: 'sweep',
        trigger: 'watch_expired'
      }
    );
    expect(mockPm).toHaveBeenCalledWith(
      1,
      'Your downloads have been disabled',
      expect.stringContaining(
        'Your ratio watch ended with your ratio still short'
      )
    );
  });

  it('writes nothing else, and sends no PM, when the claim finds the row already moved', async () => {
    short();
    mockPrismaPolicy.upsert.mockResolvedValue(makeState());
    mockPrismaPolicy.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 1 });

    expect(await evaluateRatioPolicy(1)).toBeUndefined();

    expect(mockPrismaUser.update).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockPm).not.toHaveBeenCalled();
  });

  it('starts a watch after a download, with its end date in the PM', async () => {
    short();
    mockPrismaPolicy.upsert.mockResolvedValue(makeState());

    expect(await applyRatioRules(1, 'download')).toEqual({
      kind: 'watch_started'
    });

    expect(mockAudit.mock.calls[0][2]).toBe('ratioPolicy.watch_started');
    expect(mockAudit.mock.calls[0][5]).toMatchObject({ by: 'download' });
    expect(mockPm).toHaveBeenCalledWith(
      1,
      'You are on ratio watch',
      expect.stringMatching(
        /^Your ratio is 0\.10; your required ratio is 0\.30\. You are on ratio watch until .+ GMT\./
      )
    );
  });

  it('never starts a watch from the sweep', async () => {
    short();
    mockPrismaPolicy.upsert.mockResolvedValue(makeState());

    expect(await applyRatioRules(1, 'sweep')).toBeNull();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('lifts a RATIO disable once the ratio meets its requirement', async () => {
    meets();
    mockPrismaPolicy.upsert.mockResolvedValue(
      makeState({
        status: RatioPolicyStatus.DOWNLOAD_DISABLED,
        disabledCause: RatioDisableCause.RATIO
      })
    );

    expect(await applyRatioRules(1, 'sweep')).toEqual({
      kind: 'download_restored'
    });
    expect(mockPrismaUser.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { canDownload: true }
    });
    expect(mockPm).toHaveBeenCalledWith(
      1,
      'Your downloads have been restored',
      expect.any(String)
    );
  });

  it('commits the transition even when the PM fails', async () => {
    meets();
    mockPrismaPolicy.upsert.mockResolvedValue(
      makeState({ status: RatioPolicyStatus.WATCH, watchStartedAt: new Date() })
    );
    mockPm.mockRejectedValue(new Error('smtp down'));

    await expect(applyRatioRules(1, 'download')).resolves.toEqual({
      kind: 'watch_cleared'
    });
    expect(mockAudit).toHaveBeenCalledTimes(1);
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
