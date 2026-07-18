import { request, app, resetApiTestState } from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

describe('GET /api/docs/json', () => {
  // buildOpenApiDocument() assembles the whole spec on the first request and can
  // exceed Jest's 5s default under full-suite worker contention (observed ~21s),
  // failing on timeout before the assertions run.
  it('returns the OpenAPI spec as JSON', async () => {
    const res = await request(app).get('/api/docs/json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('openapi');
    expect(res.body).toHaveProperty('info');
  }, 30_000);
});
