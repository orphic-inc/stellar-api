import { request, app, resetApiTestState } from './test/apiTestHarness';
import { appVersion } from './lib/version';

beforeEach(() => resetApiTestState());

// ─── GET /api/version ─────────────────────────────────────────────────────────

describe('GET /api/version', () => {
  it('returns the running platform version', async () => {
    const res = await request(app).get('/api/version');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: appVersion });
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  // Mounted before the install gate — version is install-independent, so it must
  // not 503 on a fresh, uninstalled instance (the harness default).
  it('is reachable without the install gate blocking it', async () => {
    const res = await request(app).get('/api/version');
    expect(res.status).not.toBe(503);
  });
});
