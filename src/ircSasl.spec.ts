import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

const SECRET = 'test-sasl-secret';
const IRC_KEY = 'k'.repeat(32);

const validBody = { account: '7', password: IRC_KEY };

const post = (body: unknown, secret: string | null = SECRET) => {
  const req = request(app).post('/internal/irc/sasl');
  if (secret !== null) req.set('Authorization', `Bearer ${secret}`);
  return req.send(body);
};

// ─── shared-secret gate ───────────────────────────────────────────────────────

describe('POST /internal/irc/sasl — secret', () => {
  it('rejects a request without the shared secret (401)', async () => {
    const res = await post(validBody, null);
    expect(res.status).toBe(401);
  });

  it('rejects a request with the wrong shared secret (401)', async () => {
    const res = await post(validBody, 'nope');
    expect(res.status).toBe(401);
  });
});

// ─── validation ───────────────────────────────────────────────────────────────

describe('POST /internal/irc/sasl — validation', () => {
  it('rejects a body missing the password (400)', async () => {
    const res = await post({ account: '7' });
    expect(res.status).toBe(400);
  });
});

// ─── delegated validation ─────────────────────────────────────────────────────

describe('POST /internal/irc/sasl — validation outcome', () => {
  it('accepts a matching ircKey and returns the resolved userId', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7,
      ircKey: IRC_KEY,
      disabled: false
    } as never);

    const res = await post(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, userId: 7 });
  });

  it('rejects a mismatched ircKey (403)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7,
      ircKey: IRC_KEY,
      disabled: false
    } as never);

    const res = await post({ account: '7', password: 'x'.repeat(32) });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ ok: false });
  });

  it('rejects an unknown account (403)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await post(validBody);
    expect(res.status).toBe(403);
  });

  it('rejects a disabled account (403)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7,
      ircKey: IRC_KEY,
      disabled: true
    } as never);
    const res = await post(validBody);
    expect(res.status).toBe(403);
  });

  it('rejects a member who never enrolled (null ircKey, 403)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7,
      ircKey: null,
      disabled: false
    } as never);
    const res = await post(validBody);
    expect(res.status).toBe(403);
  });

  it('rejects a non-numeric account without hitting the DB (403)', async () => {
    const res = await post({ account: 'alice', password: IRC_KEY });
    expect(res.status).toBe(403);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});
