/**
 * The remote image backfill (#738): who owns each URL, how the drain waits,
 * and the report. Queueing against a real database, and idempotence, are in
 * `remoteImage.integration.ts`.
 */
import { mockDeep, mockReset } from 'jest-mock-extended';
import type { PrismaClient } from '@prisma/client';

const prismaMock = mockDeep<PrismaClient>();
jest.mock('./lib/prisma', () => ({ prisma: prismaMock }));

// Plain functions over variables: resetMocks would strip a factory jest.fn.
let processCalls = 0;
jest.mock('./modules/remoteImage', () => ({
  ...jest.requireActual('./modules/remoteImage'),
  processDueRemoteImages: () => {
    processCalls++;
    return Promise.resolve({ imported: 0, retry: 0, failed: 0 });
  }
}));

import type { ImageValue } from './modules/imageColumns';
import {
  drainBackfill,
  findBackfill,
  formatBackfillReport,
  queueBackfill,
  reportBackfill
} from './modules/remoteImageBackfill';
import { imageImport } from './modules/config';

const SYSTEM = 1;
const A = 'https://a.example/one.png';
const B = 'https://b.example/two.png';

const v = (over: Partial<ImageValue>): ImageValue => ({
  surface: 'forumPost.body',
  kind: 'body',
  text: `[img]${A}[/img]`,
  ownerId: 10,
  at: new Date('2026-02-01'),
  ...over
});

beforeEach(() => {
  mockReset(prismaMock);
  processCalls = 0;
});

describe('findBackfill', () => {
  it('gives each URL to the author of the earliest value holding it', () => {
    const { owners } = findBackfill(
      [
        v({ ownerId: 10, at: new Date('2026-03-01') }),
        v({ ownerId: 20, at: new Date('2026-01-01'), surface: 'comment.body' }),
        v({ ownerId: 30, at: null })
      ],
      SYSTEM
    );
    expect(owners.get(A)).toBe(20);
  });

  it('gives a URL from a table with no author to the System user', () => {
    const { owners } = findBackfill(
      [v({ surface: 'news.body', ownerId: null })],
      SYSTEM
    );
    expect(owners.get(A)).toBe(SYSTEM);
  });

  it('counts distinct URLs per surface, fields included, remote only', () => {
    const { owners, bySurface } = findBackfill(
      [
        v({ text: `[img]${A}[/img] [img]${A}[/img] [img]${B}[/img]` }),
        v({ surface: 'user.avatar', kind: 'field', text: B }),
        v({
          surface: 'user.avatar',
          kind: 'field',
          text: `/api/asset/${'a'.repeat(64)}`
        })
      ],
      SYSTEM
    );
    expect(bySurface.get('forumPost.body')?.size).toBe(2);
    expect(bySurface.get('user.avatar')).toEqual(new Set([B]));
    expect([...owners.keys()].sort()).toEqual([A, B]);
  });
});

describe('queueBackfill', () => {
  it("queues past the owner's daily ceiling, which limits only new writes", async () => {
    prismaMock.remoteImage.findMany.mockResolvedValue([]);
    prismaMock.remoteImage.count.mockResolvedValue(imageImport.dailyLimit);
    prismaMock.remoteImage.createMany.mockResolvedValue({ count: 1 });

    expect(await queueBackfill(prismaMock, new Map([[A, 10]]))).toBe(1);
    expect(prismaMock.remoteImage.createMany).toHaveBeenCalledWith({
      data: [{ url: A, requestedById: 10 }],
      skipDuplicates: true
    });
  });
});

describe('drainBackfill', () => {
  const sleeps: number[] = [];
  const sleep = (ms: number) => {
    sleeps.push(ms);
    return Promise.resolve();
  };
  beforeEach(() => (sleeps.length = 0));

  it('stops as soon as nothing is pending', async () => {
    prismaMock.remoteImage.findFirst.mockResolvedValue(null);
    await drainBackfill(prismaMock, [A], {
      deadline: Date.now() + 60_000,
      sleep
    });
    expect(processCalls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('waits for the next retry, at most 30 s at a time', async () => {
    prismaMock.remoteImage.findFirst
      .mockResolvedValueOnce({
        nextAttemptAt: new Date(Date.now() + 10 * 60_000)
      } as never)
      .mockResolvedValueOnce(null);
    await drainBackfill(prismaMock, [A], {
      deadline: Date.now() + 60 * 60_000,
      sleep
    });
    expect(sleeps).toEqual([30_000]);
    expect(processCalls).toBe(2);
  });

  it('gives up at the deadline with a URL still pending', async () => {
    prismaMock.remoteImage.findFirst.mockResolvedValue({
      nextAttemptAt: new Date(Date.now() + 60 * 60_000)
    } as never);
    await drainBackfill(prismaMock, [A], { deadline: Date.now() - 1, sleep });
    expect(processCalls).toBe(1);
    expect(sleeps).toEqual([]);
  });
});

describe('the report', () => {
  it('counts each status and groups failures by host with their reasons', async () => {
    prismaMock.remoteImage.findMany.mockResolvedValue([
      { url: A, status: 'imported', reason: null },
      { url: B, status: 'failed', reason: 'HTTP 404' }
    ] as never);
    const found = findBackfill(
      [
        v({
          text: `[img]${A}[/img] [img]${B}[/img] [img]https://c.example/3.png[/img]`
        })
      ],
      SYSTEM
    );

    const report = await reportBackfill(prismaMock, found, 2);

    expect(report).toMatchObject({
      bySurface: { 'forumPost.body': 3 },
      total: 3,
      queued: 2,
      imported: 1,
      // c.example has no row at all, so it is not done.
      pending: 1,
      failed: [{ url: B, host: 'b.example', reason: 'HTTP 404' }]
    });
    const text = formatBackfillReport(report);
    expect(text).toContain('Failed on b.example (1):');
    expect(text).toContain(`  ${B}\n    HTTP 404`);
    expect(text).toContain('Pending:  1');
  });
});
