/**
 * The Member Feed's two limiters, driven for real (ADR-0014 §5, #262).
 *
 * Two limiters rather than one per-IP limiter is a design decision with three
 * consequences, and each case below pins one:
 *
 *  1. Failures are bounded per IP — `feedAuthLimiter` refuses after 30 404s.
 *  2. Successful polling is never counted against that budget, and neither is
 *     a member's own 429 — so an aggregator's IP is not spent by one member.
 *  3. Reads are bounded per MEMBER — `feedLimiter` refuses one member at 120
 *     while another member behind the same IP keeps reading.
 *
 * Deliberately NOT built on apiTestHarness: it mocks `express-rate-limit` away,
 * and swapping the real library back in through an isolated module registry
 * proved unreliable (the registry dropped the harness's other mocks, config
 * included). So this mounts the real feeds router on a bare app, with the real
 * limiters, and mocks only what the router reaches.
 */
jest.mock('./modules/config', () => ({
  feeds: { secret: 'f'.repeat(32) },
  email: { siteUrl: 'http://localhost:3000' },
  site: { name: 'Stellar', staffPmPath: '/inbox/staff' },
  logging: { level: 'error', timestampFormat: undefined }
}));
jest.mock('./lib/prisma', () => ({
  prisma: jest.requireActual('jest-mock-extended').mockDeep()
}));
jest.mock('./modules/pm', () => ({ sendSystemMessage: jest.fn() }));
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (html: string) => html, addHook: jest.fn() }
}));

import express from 'express';
import supertest from 'supertest';
import type { Server } from 'http';
import type { DeepMockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { prisma } from './lib/prisma';
import { deriveFeedToken } from './modules/feedToken';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const LIVE = [9, 10];

let server: Server;

beforeEach(async () => {
  prismaMock.news.findMany.mockResolvedValue([]);
  prismaMock.user.findUnique.mockImplementation((async ({
    where
  }: {
    where: { id: number };
  }) =>
    LIVE.includes(where.id)
      ? {
          id: where.id,
          disabled: false,
          feedTokenEpoch: 0,
          userSettings: { showMatureContent: false }
        }
      : null) as never);

  // Fresh limiter stores per case: the limiters are module singletons.
  let router: express.Router;
  await jest.isolateModulesAsync(async () => {
    router = (await import('./routes/api/feeds')).default;
  });
  const app = express();
  app.use('/api/feeds', router!);
  server = app.listen(0);
});

afterEach(() => {
  server.close();
});

const read = async (query: string) =>
  (await supertest(server).get(`/api/feeds/news.xml?${query}`)).status;

const valid = (member: number) =>
  `user=${member}&token=${deriveFeedToken(member, 0)}`;
const invalid = 'user=9&token=nope';

const statuses = async (n: number, query: string) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(await read(query));
  return out;
};

describe('Member Feed limiters (#262)', () => {
  it('refuses an IP after 30 failed feed requests', async () => {
    const out = await statuses(31, invalid);

    expect(out.slice(0, 30)).toEqual(Array(30).fill(404));
    expect(out[30]).toBe(429);
  });

  it("does not count successful polling against the IP's failure budget", async () => {
    expect(await statuses(40, valid(9))).toEqual(Array(40).fill(200));

    const out = await statuses(31, invalid);
    expect(out.slice(0, 30)).toEqual(Array(30).fill(404));
    expect(out[30]).toBe(429);
  });

  it('refuses one member at 120 reads while another member on the same IP keeps reading', async () => {
    expect(await statuses(120, valid(9))).toEqual(Array(120).fill(200));
    expect(await read(valid(9))).toBe(429);

    expect(await read(valid(10))).toBe(200);
  });

  it("does not count a member's own 429s as failures against the IP", async () => {
    await statuses(120, valid(9));
    expect(await statuses(5, valid(9))).toEqual(Array(5).fill(429));

    const out = await statuses(31, invalid);
    expect(out.slice(0, 30)).toEqual(Array(30).fill(404));
    expect(out[30]).toBe(429);
  });
});
