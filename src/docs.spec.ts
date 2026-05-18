import { request, app, resetApiTestState } from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

describe('GET /api/docs/json', () => {
  it('returns the OpenAPI spec as JSON', async () => {
    const res = await request(app).get('/api/docs/json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('openapi');
    expect(res.body).toHaveProperty('info');
  });
});
