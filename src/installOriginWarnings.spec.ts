import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';
import { email as emailConfig, http as httpConfig } from './modules/config';

/**
 * `GET /api/install` launch warnings for the two origins (#667).
 *
 * The route already emitted `site-url-default` and `cors-origin-default`, but
 * nothing asserted WHICH warnings fired — `install.spec.ts` only checked that
 * `configWarnings` was an array. That is how an empty `STELLAR_SITE_URL`, the
 * one value the warning's own text claims to catch ("is not set"), went
 * unwarned: the check compared against the development default, and an empty
 * string is not equal to it.
 *
 * Config is a mocked object on the harness, so each case mutates it — the same
 * approach `inviteGrantJob.spec.ts` takes to exercise the job modes.
 */

const originalSiteUrl = emailConfig.siteUrl;
const originalCorsOrigin = httpConfig.corsOrigin;

// `configWarnings` is projected to bare message strings on the wire —
// `getConfigWarnings().map((item) => item.message)` — so the ids exist only
// inside the route. Assert on the variable each message names.
const warnings = async (): Promise<string[]> => {
  const res = await request(app).get('/api/install');
  expect(res.status).toBe(200);
  return res.body.configWarnings;
};

const mentions = (list: string[], variable: string) =>
  list.some((message) => message.includes(variable));

beforeEach(() => {
  resetApiTestState();
  prismaMock.siteSettings.findFirst.mockResolvedValue({
    id: 1,
    installedAt: new Date(),
    registrationStatus: 'closed',
    maxUsers: 7000,
    dismissedLaunchChecklist: []
  } as never);
});

afterEach(() => {
  emailConfig.siteUrl = originalSiteUrl;
  httpConfig.corsOrigin = originalCorsOrigin;
});

describe('site-url-default warning (#667)', () => {
  it('fires on the development origin', async () => {
    emailConfig.siteUrl = 'http://localhost:9000';
    expect(mentions(await warnings(), 'STELLAR_SITE_URL')).toBe(true);
  });

  it('fires on the example hostname stellar-compose ships', async () => {
    emailConfig.siteUrl = 'https://example.org';
    expect(mentions(await warnings(), 'STELLAR_SITE_URL')).toBe(true);
  });

  it('fires on example.com too', async () => {
    emailConfig.siteUrl = 'https://example.com';
    expect(mentions(await warnings(), 'STELLAR_SITE_URL')).toBe(true);
  });

  it('stays quiet once a real hostname is configured', async () => {
    emailConfig.siteUrl = 'https://tracker.example.test';
    expect(mentions(await warnings(), 'STELLAR_SITE_URL')).toBe(false);
  });

  it('names what breaks, so the warning is actionable', async () => {
    emailConfig.siteUrl = 'http://localhost:9000';
    const message = (await warnings()).find((w) =>
      w.includes('STELLAR_SITE_URL')
    );
    expect(message).toMatch(/recovery/i);
  });
});

describe('cors-origin-default warning (#667)', () => {
  it('fires on the development origin', async () => {
    httpConfig.corsOrigin = 'http://localhost:9000';
    expect(mentions(await warnings(), 'STELLAR_HTTP_CORS_ORIGIN')).toBe(true);
  });

  it('fires on an example hostname', async () => {
    httpConfig.corsOrigin = 'https://example.org';
    expect(mentions(await warnings(), 'STELLAR_HTTP_CORS_ORIGIN')).toBe(true);
  });

  it('stays quiet once a real hostname is configured', async () => {
    httpConfig.corsOrigin = 'https://ui.example.test';
    expect(mentions(await warnings(), 'STELLAR_HTTP_CORS_ORIGIN')).toBe(false);
  });
});

describe('the two origins warn independently (#667)', () => {
  it('warns only about the one left unconfigured', async () => {
    emailConfig.siteUrl = 'https://tracker.example.test';
    httpConfig.corsOrigin = 'http://localhost:9000';

    const list = await warnings();
    expect(mentions(list, 'STELLAR_HTTP_CORS_ORIGIN')).toBe(true);
    expect(mentions(list, 'STELLAR_SITE_URL')).toBe(false);
  });
});
