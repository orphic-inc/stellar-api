// Loaded first for its mocks. It replaces `express-rate-limit` with a
// pass-through, so the structural cases below read limiter IDENTITY off the
// built app, and the one case that needs a limiter to really count builds its
// own app with the real library.
import supertest from 'supertest';
import { app } from './test/apiTestHarness';
import { mutationRateLimit, writeLimiter } from './middleware/rateLimiter';

/**
 * Where the site-wide write limiter sits, and that nothing counts twice (#560).
 *
 * Two defects, one cause: the limiter's guarantee depended on mount order.
 * `/api/install` was mounted above it, so `POST /install/checklist/:id/dismiss`
 * had no limiter at all; and the forum topic and post routes mounted
 * `writeLimiter` a second time BELOW it, so one request incremented the same
 * store twice and those routes refused at 15 a minute rather than 30.
 */

interface Layer {
  handle?: { stack?: Layer[] } & object;
  route?: { stack: { handle: unknown }[] };
}

const appStack = (): Layer[] =>
  (app as unknown as { _router: { stack: Layer[] } })._router.stack;

/** Every handler in the tree, router-level and per-route alike. */
const allHandlers = (stack: Layer[]): unknown[] =>
  stack.flatMap((layer) => {
    if (layer.route) return layer.route.stack.map((h) => h.handle);
    if (layer.handle?.stack) return allHandlers(layer.handle.stack);
    return [layer.handle];
  });

describe('site-wide write limiter mount (#560)', () => {
  it('is mounted above every router, so none escapes it by mount order', () => {
    const stack = appStack();
    const limiterAt = stack.findIndex((l) => l.handle === mutationRateLimit);
    const firstRouterAt = stack.findIndex((l) => l.handle?.stack);

    expect(limiterAt).toBeGreaterThanOrEqual(0);
    expect(limiterAt).toBeLessThan(firstRouterAt);
  });

  it('is never mounted a second time on a route beneath it', () => {
    // `mutationRateLimit` already runs `writeLimiter` for every mutation. The
    // same instance mounted again shares its store, so it would count the
    // request twice. A route wanting a tighter limit needs its own instance.
    const handlers = allHandlers(appStack());

    expect(handlers.filter((h) => h === mutationRateLimit)).toHaveLength(1);
    expect(handlers).not.toContain(writeLimiter);
  });

  it('refuses the checklist dismiss once the write budget is spent', async () => {
    // The real limiter, in a module registry of its own. No session is needed:
    // the limiter runs BEFORE `requirePermission`, so every attempt is counted
    // whether or not the permission gate refuses it. Which refusal that is
    // depends on the harness's auth mock and is not the point; that it never
    // becomes a 429 is what #560 fixed.
    let realApp: typeof app;
    await jest.isolateModulesAsync(async () => {
      // `dontMock`, not a `doMock` factory returning the actual module: the
      // harness's `jest.mock` factory wins over the latter.
      jest.dontMock('express-rate-limit');
      // The isolated registry has its own prisma mock; the IP-ban check reads it.
      const { prisma } = await import('./lib/prisma');
      (prisma.ipBan.findMany as unknown as jest.Mock).mockResolvedValue([]);
      realApp = (await import('./app')).createApp();
    });

    // Supertest directly: the harness's `request` ignores its argument and
    // always targets the harness app, whose limiters are mocked. One server for
    // all 31 requests, for the port-churn reason the harness records.
    const server = realApp!.listen(0);
    const statuses: number[] = [];
    try {
      for (let i = 0; i < 31; i++) {
        const res = await supertest(server).post(
          '/api/install/checklist/smtp/dismiss'
        );
        statuses.push(res.status);
      }
    } finally {
      server.close();
    }

    expect(statuses.slice(0, 30)).not.toContain(429);
    expect(statuses[30]).toBe(429);
  });
});
