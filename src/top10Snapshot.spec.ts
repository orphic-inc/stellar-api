/**
 * Unit tests for the REAL createSnapshot (#491). Prisma is mocked; the module
 * itself is not.
 *
 * This file exists because `top10.spec.ts` mocks `modules/top10` wholesale, so
 * its `passes Weekly type when body.type is Weekly` case asserts only that the
 * ROUTE forwards the string. That is the layer above the bug: createSnapshot
 * hardcoded `getTopReleases({ type: 'day' })` and wrote the caller's `type` to
 * the column as a label, so a Weekly snapshot stored the daily top 10 and the
 * mocked test stayed green through all of it.
 *
 * So the assertion here is deliberately on the WINDOW that reaches the query,
 * not on the argument createSnapshot was handed. `getTopReleases` binds the
 * window boundary as a `$queryRaw` parameter (`AND dag."createdAt" >= ${win}`),
 * which is the last observable point before the database and the first one that
 * can tell a Daily snapshot from a Weekly one.
 */

import { mockDeep, mockReset } from 'jest-mock-extended';
import { type PrismaClient } from '@prisma/client';

const prismaMock = mockDeep<PrismaClient>();
jest.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { createSnapshot } from './modules/top10';

const DAY_MS = 86_400_000;

/**
 * The window boundary `getTopReleases` bound into its query, recovered from the
 * mocked `$queryRaw` call. The fragments interpolated into the template arrive
 * as Prisma.Sql objects (the mock does no flattening) and carry their bound
 * parameters on `.values`; exactly one of those is a Date — the window filter.
 *
 * Matched structurally rather than with `instanceof Prisma.Sql`: that class is
 * a runtime export the client does not surface here, and `instanceof` against
 * an undefined right-hand side throws rather than returning false.
 */
const boundWindowStart = (): Date | undefined => {
  const call = prismaMock.$queryRaw.mock.calls.at(-1);
  if (!call) return undefined;
  for (const arg of call.slice(1)) {
    if (arg instanceof Date) return arg;
    const values = (arg as { values?: unknown[] } | null)?.values;
    if (Array.isArray(values)) {
      const date = values.find((v): v is Date => v instanceof Date);
      if (date) return date;
    }
  }
  return undefined;
};

beforeEach(() => {
  mockReset(prismaMock);
  // No rows: the snapshot is written with zero entries, which is irrelevant to
  // the window and keeps the test off getTopReleases' row-shaping path.
  prismaMock.$queryRaw.mockResolvedValue([]);
  // getTopReleases always calls attachTags, even for an empty result set.
  prismaMock.releaseTag.findMany.mockResolvedValue([]);
  prismaMock.top10Snapshot.create.mockResolvedValue({} as never);
});

describe('createSnapshot', () => {
  it('captures the last 7 days for a Weekly snapshot', async () => {
    const before = Date.now();
    await createSnapshot('Weekly');

    const win = boundWindowStart();
    expect(win).toBeInstanceOf(Date);
    // ~7 days back, allowing a generous margin for clock movement in-test.
    const agoMs = before - win!.getTime();
    expect(agoMs).toBeGreaterThan(6.9 * DAY_MS);
    expect(agoMs).toBeLessThan(7.1 * DAY_MS);
  });

  it('captures the last 24 hours for a Daily snapshot', async () => {
    const before = Date.now();
    await createSnapshot('Daily');

    const win = boundWindowStart();
    expect(win).toBeInstanceOf(Date);
    const agoMs = before - win!.getTime();
    expect(agoMs).toBeGreaterThan(0.9 * DAY_MS);
    expect(agoMs).toBeLessThan(1.1 * DAY_MS);
  });

  it('files the row under the type it was asked for', async () => {
    await createSnapshot('Weekly');

    expect(prismaMock.top10Snapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'Weekly' })
      })
    );
  });

  // The regression itself: before #491 both types produced the SAME window, so
  // this is the single assertion that would have failed on the old code.
  it('does not capture the same window for both types', async () => {
    await createSnapshot('Daily');
    const daily = boundWindowStart()!.getTime();

    await createSnapshot('Weekly');
    const weekly = boundWindowStart()!.getTime();

    expect(weekly).toBeLessThan(daily);
  });
});
