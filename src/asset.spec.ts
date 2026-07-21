/**
 * Route-level tests for the asset delivery route (ADR-0026, #290) — the headers
 * are the contract here: a wrong Content-Type or a cacheable 404 is the whole
 * bug surface for a route that otherwise just returns bytes.
 */
import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

const HASH = 'a'.repeat(64);
const BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const storedAsset = {
  id: 1,
  hash: HASH,
  mime: 'image/png',
  size: BYTES.length,
  kind: 'ThemeImage',
  data: BYTES,
  ownerId: null,
  createdAt: new Date('2026-07-19T00:00:00Z')
};

// A member upload — auth-gated and cached privately so a shared cache can't hand
// the bytes to an unauthenticated fetch.
const memberAsset = { ...storedAsset, ownerId: 7 };

describe('GET /api/asset/:hash', () => {
  it('delivers the stored bytes with the verified mime and immutable caching', async () => {
    prismaMock.asset.findUnique.mockResolvedValue(storedAsset as never);

    const res = await request(app).get(`/api/asset/${HASH}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    // Immutable is literally true — the bytes at a hash can never change.
    expect(res.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['etag']).toBe(`"${HASH}"`);
    expect(Buffer.from(res.body)).toEqual(BYTES);
  });

  it('resolves by content address, not by row id', async () => {
    prismaMock.asset.findUnique.mockResolvedValue(storedAsset as never);

    await request(app).get(`/api/asset/${HASH}`);

    expect(prismaMock.asset.findUnique).toHaveBeenCalledWith({
      where: { hash: HASH }
    });
  });

  it('serves a site-owned asset without authentication', async () => {
    // Theme imagery is fetched as a CSS subresource; an auth round-trip buys
    // nothing over site-shipped bytes at a non-enumerable address.
    prismaMock.asset.findUnique.mockResolvedValue(storedAsset as never);

    const res = await request(app).get(`/api/asset/${HASH}`).set('Cookie', '');

    expect(res.status).toBe(200);
  });

  it('caches a member-owned asset privately, not in shared caches', async () => {
    // The harness authenticates every request, so the gate passes here; the real
    // 401 for an anonymous fetch is covered in integration. What this pins is the
    // header split — a shared cache must never hold a member's asset.
    prismaMock.asset.findUnique.mockResolvedValue(memberAsset as never);

    const res = await request(app).get(`/api/asset/${HASH}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(
      'private, max-age=31536000, immutable'
    );
    expect(Buffer.from(res.body)).toEqual(BYTES);
  });

  it('404s an unknown hash as { msg }', async () => {
    prismaMock.asset.findUnique.mockResolvedValue(null);

    const res = await request(app).get(`/api/asset/${'b'.repeat(64)}`);

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Asset not found');
    // A missing asset must never be cached as if it were immutable.
    expect(res.headers['cache-control']).toBeUndefined();
  });

  it.each([
    ['too short', 'abc'],
    ['not hex', 'g'.repeat(64)],
    ['uppercase hex', 'A'.repeat(64)],
    ['a row id', '1']
  ])(
    'rejects a malformed address (%s) without a DB read',
    async (_label, bad) => {
      const res = await request(app).get(`/api/asset/${bad}`);

      expect(res.status).toBe(400);
      expect(prismaMock.asset.findUnique).not.toHaveBeenCalled();
    }
  );
});

describe('POST /api/asset', () => {
  const withRank = (assetLimit: number | null) =>
    prismaMock.userRank.findUnique.mockResolvedValue({
      id: 1,
      assetLimit
    } as never);

  it('stores an uploaded image owned by the caller and returns its address', async () => {
    withRank(null); // unlimited
    prismaMock.asset.findUnique.mockResolvedValue(null);
    prismaMock.asset.create.mockResolvedValue({
      id: 5,
      hash: HASH,
      mime: 'image/png',
      size: BYTES.length,
      kind: 'ThemeImage'
    } as never);

    const res = await request(app)
      .post('/api/asset')
      .set('Content-Type', 'image/png')
      .send(BYTES);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      hash: HASH,
      url: `/api/asset/${HASH}`,
      mime: 'image/png',
      size: BYTES.length,
      kind: 'ThemeImage'
    });
    expect(prismaMock.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: 7 })
      })
    );
  });

  it('rejects a rank that cannot upload (assetLimit 0)', async () => {
    withRank(0);

    const res = await request(app)
      .post('/api/asset')
      .set('Content-Type', 'image/png')
      .send(BYTES);

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/cannot upload/);
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('rejects when the caller is at their count limit', async () => {
    withRank(3);
    prismaMock.asset.findFirst.mockResolvedValue(null);
    prismaMock.asset.count.mockResolvedValue(3);

    const res = await request(app)
      .post('/api/asset')
      .set('Content-Type', 'image/png')
      .send(BYTES);

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/limit reached/);
  });

  it('rejects a font upload (fonts stay seeder-only)', async () => {
    withRank(null);
    const WOFF2 = Buffer.concat([
      Buffer.from([0x77, 0x4f, 0x46, 0x32]),
      Buffer.from('font')
    ]);

    const res = await request(app)
      .post('/api/asset')
      .set('Content-Type', 'font/woff2')
      .send(WOFF2);

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/Only images/);
  });

  it('rejects a Content-Type outside the allowlist with guidance', async () => {
    // express.raw does not claim the body, so it never buffers — the handler
    // sees the empty object and tells the caller how to send the asset.
    withRank(null);

    const res = await request(app)
      .post('/api/asset')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ not: 'an image' }));

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/raw body/);
  });
});
