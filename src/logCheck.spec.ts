import { readFileSync } from 'fs';
import { join } from 'path';
import { request, app, resetApiTestState } from './test/apiTestHarness';

// requireAuth is globally mocked by the harness (always authenticated as user 7),
// so the 401 path is not exercised here — it's covered by the route's requireAuth
// wiring, same as every other login-gated route spec in this suite. These tests
// cover the un-mocked seam: body validation and the scorer's output shape.

const fixture = (name: string, enc: BufferEncoding): string =>
  readFileSync(join(__dirname, 'modules/logChecker/__fixtures__', name), enc);

beforeEach(() => resetApiTestState());

describe('POST /api/log-check', () => {
  it('scores a perfect EAC log at 100', async () => {
    const res = await request(app)
      .post('/api/log-check')
      .send({ log: fixture('eac-loveless.log', 'utf16le') });

    expect(res.status).toBe(200);
    expect(res.body.ripper).toBe('EAC');
    expect(res.body.score).toBe(100);
    expect(res.body.isPerfect).toBe(true);
    expect(res.body.deductions).toEqual([]);
  });

  it('scores a perfect XLD log at 100', async () => {
    const res = await request(app)
      .post('/api/log-check')
      .send({ log: fixture('xld-liquid-sword.log', 'utf8') });

    expect(res.status).toBe(200);
    expect(res.body.ripper).toBe('XLD');
    expect(res.body.score).toBe(100);
    expect(res.body.isPerfect).toBe(true);
  });

  it('returns 200 with ripper null for an unrecognized log', async () => {
    const res = await request(app)
      .post('/api/log-check')
      .send({ log: 'definitely not a rip log' });

    expect(res.status).toBe(200);
    expect(res.body.ripper).toBeNull();
    expect(res.body.score).toBe(0);
    expect(res.body.isPerfect).toBe(false);
  });

  it('rejects an empty log with 400', async () => {
    const res = await request(app).post('/api/log-check').send({ log: '' });

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Validation failed');
  });

  it('rejects a missing log field with 400', async () => {
    const res = await request(app).post('/api/log-check').send({});

    expect(res.status).toBe(400);
  });
});
