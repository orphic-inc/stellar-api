/**
 * Unit tests for the CRS snapshot module (#94) — verifies the capture reads
 * recently-active users, recomputes each one's CRS via `getReputation`, writes
 * idempotently in concurrency-bounded chunks, and prunes by retention; and that
 * the history query reads oldest-first. Prisma and `getReputation` are mocked;
 * `getBucket` and `getRetentionCutoff` run for real.
 */

import { mockDeep, mockReset } from 'jest-mock-extended';
import type { PrismaClient } from '@prisma/client';

const prismaMock = mockDeep<PrismaClient>();
jest.mock('./lib/prisma', () => ({ prisma: prismaMock }));

jest.mock('./modules/logging', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })
}));

const getReputation = jest.fn();
jest.mock('./modules/reputation', () => ({
  getReputation: (id: number) => getReputation(id)
}));

import { captureCrsSnapshots, getCrsHistory } from './modules/crsHistory';

beforeEach(() => {
  mockReset(prismaMock);
  getReputation.mockReset();
});

// ─── captureCrsSnapshots ──────────────────────────────────────────────────────

describe('captureCrsSnapshots', () => {
  it('snapshots each active user, writes with skipDuplicates, prunes by period', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
    getReputation.mockImplementation((id: number) =>
      Promise.resolve({
        score: id * 10,
        dimensions: [{ name: 'longevity', subScore: id, weighted: id }]
      })
    );
    prismaMock.crsSnapshot.createMany.mockResolvedValue({ count: 2 } as never);
    prismaMock.crsSnapshot.deleteMany.mockResolvedValue({ count: 0 } as never);

    await captureCrsSnapshots('Monthly');

    // Only recently-active (lastLogin gte) non-disabled users are read.
    const whereArg = prismaMock.user.findMany.mock.calls[0][0] as {
      where: { disabled: boolean; lastLogin: { gte: Date } };
    };
    expect(whereArg.where.disabled).toBe(false);
    expect(whereArg.where.lastLogin.gte).toBeInstanceOf(Date);

    expect(getReputation).toHaveBeenCalledTimes(2);

    const createArg = prismaMock.crsSnapshot.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
      skipDuplicates: boolean;
    };
    expect(createArg.skipDuplicates).toBe(true);
    expect(createArg.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 1,
          period: 'Monthly',
          score: 10,
          dimensions: [{ name: 'longevity', subScore: 1, weighted: 1 }]
        }),
        expect.objectContaining({ userId: 2, period: 'Monthly', score: 20 })
      ])
    );

    expect(prismaMock.crsSnapshot.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ period: 'Monthly' })
      })
    );
  });

  it('skips createMany when no users are active, still prunes', async () => {
    prismaMock.user.findMany.mockResolvedValue([] as never);
    prismaMock.crsSnapshot.deleteMany.mockResolvedValue({ count: 0 } as never);

    await captureCrsSnapshots('Monthly');

    expect(getReputation).not.toHaveBeenCalled();
    expect(prismaMock.crsSnapshot.createMany).not.toHaveBeenCalled();
    expect(prismaMock.crsSnapshot.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ period: 'Monthly' })
      })
    );
  });

  it('snapshots every active user across chunk boundaries', async () => {
    // More than one CONCURRENCY chunk (25) to exercise the chunk loop.
    const users = Array.from({ length: 60 }, (_, i) => ({ id: i + 1 }));
    prismaMock.user.findMany.mockResolvedValue(users as never);
    getReputation.mockResolvedValue({ score: 1, dimensions: [] });
    prismaMock.crsSnapshot.createMany.mockResolvedValue({ count: 60 } as never);
    prismaMock.crsSnapshot.deleteMany.mockResolvedValue({ count: 0 } as never);

    await captureCrsSnapshots('Yearly');

    expect(getReputation).toHaveBeenCalledTimes(60);
    const createArg = prismaMock.crsSnapshot.createMany.mock.calls[0][0] as {
      data: unknown[];
    };
    expect(createArg.data).toHaveLength(60);
  });
});

// ─── getCrsHistory ────────────────────────────────────────────────────────────

describe('getCrsHistory', () => {
  it('queries the user + period, oldest-first', async () => {
    prismaMock.crsSnapshot.findMany.mockResolvedValue([] as never);

    await getCrsHistory(7, 'Yearly');

    expect(prismaMock.crsSnapshot.findMany).toHaveBeenCalledWith({
      where: { userId: 7, period: 'Yearly' },
      orderBy: { capturedAt: 'asc' }
    });
  });

  it('serializes capturedAt to ISO and passes through score/dimensions', async () => {
    const capturedAt = new Date('2026-06-21T00:00:00.000Z');
    prismaMock.crsSnapshot.findMany.mockResolvedValue([
      {
        capturedAt,
        period: 'Monthly',
        score: 12.5,
        dimensions: [{ name: 'ratio', subScore: 4, weighted: 4 }]
      }
    ] as never);

    const out = await getCrsHistory(1, 'Monthly');

    expect(out).toEqual([
      {
        capturedAt: '2026-06-21T00:00:00.000Z',
        period: 'Monthly',
        score: 12.5,
        dimensions: [{ name: 'ratio', subScore: 4, weighted: 4 }]
      }
    ]);
  });
});
