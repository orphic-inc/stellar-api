/**
 * Unit tests for the ratio policy state machine.
 */

import { Prisma, RatioPolicyStatus, RatioDisableCause } from '@prisma/client';

const mockPrismaUser = {
  findUniqueOrThrow: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn()
};
const mockPrismaPolicy = {
  findUnique: jest.fn(),
  findUniqueOrThrow: jest.fn(),
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
  getRatioStats: jest.fn(),
  getEligibleContributionBytes: jest.fn(),
  // The real bracket table, as a plain function so resetMocks leaves it be.
  computeRequiredRatio: (consumed: bigint, eligible: bigint) =>
    jest.requireActual('./ratio').computeRequiredRatio(consumed, eligible)
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
  getProfileRatioViews,
  listRatioWatch,
  overridePolicyStatus
} from './ratioPolicy';
import { resolveSystemActorId } from './rankProgressionJob';
import { getEligibleContributionBytes, getRatioStats } from './ratio';
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

  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('conflict', {
      code,
      clientVersion: 'test'
    });

  it("reads the winner's row when a concurrent first evaluation created it (#800)", async () => {
    short();
    // Two downloads at once, and no row yet: the other evaluation inserted first.
    mockPrismaPolicy.upsert.mockRejectedValue(prismaError('P2002'));
    mockPrismaPolicy.findUniqueOrThrow.mockResolvedValue(
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
    expect(mockPrismaPolicy.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { userId: 1 }
    });
  });

  it('still fails on any other error creating the row', async () => {
    short();
    mockPrismaPolicy.upsert.mockRejectedValue(prismaError('P2003'));

    await expect(applyRatioRules(1, 'sweep')).rejects.toMatchObject({
      code: 'P2003'
    });
    expect(mockPrismaPolicy.findUniqueOrThrow).not.toHaveBeenCalled();
  });

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

  it('breaks the watch-start tie on userId, because the read is paged (#652)', async () => {
    // `watchStartedAt` is nullable and a staff override NULLS it, so every
    // overridden DOWNLOAD_DISABLED row ties. Under `skip`/`take` a tie is not
    // cosmetic: Postgres may return tied rows in any order, and the order can
    // change between two page requests, so staff see one member on both pages
    // and never see another. The #613 guard exempts DateTime columns and
    // cannot stand here.
    jest.resetAllMocks();
    mockPrismaPolicy.findMany.mockResolvedValue([]);
    mockPrismaPolicy.count.mockResolvedValue(0);

    await listRatioWatch({ page: 2, limit: 25, skip: 25 });

    const args = mockPrismaPolicy.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([
      { watchStartedAt: 'desc' },
      { userId: 'asc' }
    ]);
    // The tiebreak is only a tiebreak if it is unique. `RatioPolicyState` has
    // no `id` column; `userId` is the @id, which is what makes this total.
    expect(args.skip).toBe(25);
  });
});

describe('getProfileRatioViews (#658)', () => {
  const NOW = new Date('2026-10-01T00:00:00Z');
  const LATER = new Date('2026-10-08T00:00:00Z');
  const EARLIER = new Date('2026-09-30T00:00:00Z');
  // 200 GiB consumed sits in the top bracket: 0.6 required with no coverage.
  const short = { contributed: 100n * GiB, consumed: 200n * GiB };
  const mockEligible = getEligibleContributionBytes as jest.MockedFunction<
    typeof getEligibleContributionBytes
  >;

  beforeEach(() => mockEligible.mockResolvedValue(0n));

  const watchRow = (over: Record<string, unknown> = {}) => ({
    status: RatioPolicyStatus.WATCH,
    watchExpiresAt: LATER,
    consumedAtWatchStart: 190n * GiB,
    disabledCause: null,
    ...over
  });

  it('shows an active watch to a viewer without the permission', async () => {
    mockPrismaPolicy.findUnique.mockResolvedValue(watchRow());

    const views = await getProfileRatioViews(1, short, false, NOW);

    expect(views).toEqual({
      ratioWatch: {
        expiresAt: LATER.toISOString(),
        deficit: (20n * GiB).toString(),
        consumedSinceWatch: (10n * GiB).toString()
      },
      ratioPolicy: null
    });
  });

  it('counts nothing consumed during a watch with no baseline', async () => {
    mockPrismaPolicy.findUnique.mockResolvedValue(
      watchRow({ consumedAtWatchStart: null })
    );

    const views = await getProfileRatioViews(1, short, false, NOW);

    expect(views.ratioWatch?.consumedSinceWatch).toBe('0');
  });

  it('hides an expired watch, without reading contributions', async () => {
    mockPrismaPolicy.findUnique.mockResolvedValue(
      watchRow({ watchExpiresAt: EARLIER })
    );

    const views = await getProfileRatioViews(1, short, false, NOW);

    expect(views.ratioWatch).toBeNull();
    expect(mockEligible).not.toHaveBeenCalled();
  });

  it('hides a watch the member is no longer short on', async () => {
    mockPrismaPolicy.findUnique.mockResolvedValue(watchRow());

    const views = await getProfileRatioViews(
      1,
      { contributed: 120n * GiB, consumed: 200n * GiB },
      false,
      NOW
    );

    expect(views.ratioWatch).toBeNull();
  });

  it('hides a download disable from a viewer without the permission', async () => {
    mockPrismaPolicy.findUnique.mockResolvedValue(
      watchRow({
        status: RatioPolicyStatus.DOWNLOAD_DISABLED,
        disabledCause: RatioDisableCause.STAFF
      })
    );

    const views = await getProfileRatioViews(1, short, false, NOW);

    expect(views).toEqual({ ratioWatch: null, ratioPolicy: null });
    expect(mockEligible).not.toHaveBeenCalled();
  });

  it('shows ratio_policy_manage a download disable and its cause', async () => {
    mockPrismaPolicy.findUnique.mockResolvedValue(
      watchRow({
        status: RatioPolicyStatus.DOWNLOAD_DISABLED,
        disabledCause: RatioDisableCause.STAFF
      })
    );

    const views = await getProfileRatioViews(1, short, true, NOW);

    expect(views).toEqual({
      ratioWatch: null,
      ratioPolicy: {
        status: RatioPolicyStatus.DOWNLOAD_DISABLED,
        disabledCause: RatioDisableCause.STAFF
      }
    });
  });

  it('reads a member with no policy row as OK', async () => {
    mockPrismaPolicy.findUnique.mockResolvedValue(null);

    const views = await getProfileRatioViews(1, short, true, NOW);

    expect(views).toEqual({
      ratioWatch: null,
      ratioPolicy: { status: RatioPolicyStatus.OK, disabledCause: null }
    });
  });
});
