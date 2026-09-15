/**
 * Unit tests for the ratio policy sweep's wiring (#646, ADR-0044 §4). The rules
 * belong to ratioPolicyRules.spec.ts and the claim to ratioPolicy.spec.ts; this
 * pins the shell — which rows it walks, how it pages, and that one member's
 * failure does not stop the cycle.
 */
import { mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@prisma/client';

const prismaMock = mockDeep<PrismaClient>();
jest.mock('../lib/prisma', () => ({ prisma: prismaMock }));
jest.mock('./ratioPolicy', () => ({ applyRatioRules: jest.fn() }));

import { applyRatioRules } from './ratioPolicy';
import {
  BATCH_SIZE,
  runRatioPolicyCycle,
  sweepableRatioStateWhere
} from './ratioPolicyJob';

const mockApply = applyRatioRules as jest.Mock;
const NOW = new Date('2026-09-15T12:00:00Z');

const rows = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ userId: from + i }));

beforeEach(() => {
  jest.resetAllMocks();
});

describe('runRatioPolicyCycle', () => {
  it('walks WATCH and RATIO-disabled rows only, by userId', async () => {
    prismaMock.ratioPolicyState.findMany.mockResolvedValue([] as never);

    await runRatioPolicyCycle(NOW);

    expect(sweepableRatioStateWhere).toEqual({
      OR: [
        { status: 'WATCH' },
        { status: 'DOWNLOAD_DISABLED', disabledCause: 'RATIO' }
      ]
    });
    expect(prismaMock.ratioPolicyState.findMany).toHaveBeenCalledWith({
      where: { ...sweepableRatioStateWhere, userId: { gt: 0 } },
      select: { userId: true },
      orderBy: [{ userId: 'asc' }],
      take: BATCH_SIZE
    });
  });

  it('applies the rules as the sweep with one clock, and tallies each transition', async () => {
    prismaMock.ratioPolicyState.findMany.mockResolvedValue(rows(1, 3) as never);
    mockApply
      .mockResolvedValueOnce({ kind: 'download_restored' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        kind: 'download_disabled',
        trigger: 'watch_expired'
      });

    expect(await runRatioPolicyCycle(NOW)).toEqual({
      evaluated: 3,
      watch_started: 0,
      watch_cleared: 0,
      download_disabled: 1,
      download_restored: 1,
      failed: 0
    });
    expect(mockApply.mock.calls).toEqual([
      [1, 'sweep', NOW],
      [2, 'sweep', NOW],
      [3, 'sweep', NOW]
    ]);
  });

  it('pages past a full batch from its last userId', async () => {
    prismaMock.ratioPolicyState.findMany
      .mockResolvedValueOnce(rows(10, BATCH_SIZE) as never)
      .mockResolvedValueOnce(rows(10 + BATCH_SIZE, 2) as never);
    mockApply.mockResolvedValue(null);

    const tally = await runRatioPolicyCycle(NOW);

    expect(tally.evaluated).toBe(BATCH_SIZE + 2);
    expect(prismaMock.ratioPolicyState.findMany).toHaveBeenCalledTimes(2);
    expect(
      prismaMock.ratioPolicyState.findMany.mock.calls[1][0]?.where
    ).toMatchObject({ userId: { gt: 10 + BATCH_SIZE - 1 } });
  });

  it('keeps going past a member whose evaluation throws', async () => {
    prismaMock.ratioPolicyState.findMany.mockResolvedValue(rows(1, 3) as never);
    mockApply
      .mockResolvedValueOnce({ kind: 'watch_cleared' })
      .mockRejectedValueOnce(new Error('bad row'))
      .mockResolvedValueOnce({ kind: 'watch_cleared' });

    expect(await runRatioPolicyCycle(NOW)).toMatchObject({
      evaluated: 2,
      watch_cleared: 2,
      failed: 1
    });
    expect(mockApply).toHaveBeenCalledTimes(3);
  });
});
