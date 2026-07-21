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
  visibility: 'Public',
  createdAt: new Date('2026-07-19T00:00:00Z')
};

// A user-uploaded asset — auth-gated, and cached privately so a shared cache
// can't hand the bytes to an unauthenticated fetch.
const memberAsset = {
  ...storedAsset,
  ownerId: 7,
  visibility: 'Members'
};

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

  it('serves a Public asset without authentication', async () => {
    // Theme imagery is fetched as a CSS subresource; an auth round-trip buys
    // nothing over site-shipped bytes at a non-enumerable address.
    prismaMock.asset.findUnique.mockResolvedValue(storedAsset as never);

    const res = await request(app).get(`/api/asset/${HASH}`).set('Cookie', '');

    expect(res.status).toBe(200);
  });

  it('caches a Members asset privately, not in shared caches', async () => {
    // The harness authenticates every request, so the gate passes here; the
    // real 401 for an anonymous fetch is covered in integration. What this pins
    // is the header split — a shared cache must never hold a member's asset.
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
  it('stores an uploaded image and returns its content address', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue({
      id: 1,
      assetByteLimit: 0
    } as never);
    prismaMock.asset.findUnique.mockResolvedValue(null);
    prismaMock.asset.create.mockResolvedValue({
      id: 5,
      hash: HASH,
      mime: 'image/png',
      size: BYTES.length,
      kind: 'Avatar'
    } as never);

    const res = await request(app)
      .post('/api/asset?kind=Avatar')
      .set('Content-Type', 'image/png')
      .send(BYTES);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      hash: HASH,
      url: `/api/asset/${HASH}`,
      mime: 'image/png',
      size: BYTES.length,
      kind: 'Avatar'
    });
    // Stored to the caller, gated, never as a Public site fixture.
    expect(prismaMock.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: 7, visibility: 'Members' })
      })
    );
  });

  it('rejects a payload whose bytes are not a supported type', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue({
      id: 1,
      assetByteLimit: 0
    } as never);

    const res = await request(app)
      .post('/api/asset?kind=Avatar')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('not really a png'));

    expect(res.status).toBe(400);
    expect(prismaMock.asset.create).not.toHaveBeenCalled();
  });

  it('rejects an unsupported kind (ThemeFont is seeder-only)', async () => {
    const res = await request(app)
      .post('/api/asset?kind=ThemeFont')
      .set('Content-Type', 'font/woff2')
      .send(BYTES);

    expect(res.status).toBe(400);
  });

  it('rejects a Content-Type outside the allowlist as a guidance 400', async () => {
    // express.raw does not claim the body, so it never buffers — the handler
    // sees the empty object and tells the caller how to send the asset.
    const res = await request(app)
      .post('/api/asset?kind=Avatar')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ not: 'an image' }));

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/raw body/);
  });

  it('rejects the upload when the rank byte budget is exhausted', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue({
      id: 1,
      assetByteLimit: 4
    } as never);
    prismaMock.asset.findFirst.mockResolvedValue(null);
    prismaMock.asset.aggregate.mockResolvedValue({
      _sum: { size: 4 }
    } as never);

    const res = await request(app)
      .post('/api/asset?kind=Avatar')
      .set('Content-Type', 'image/png')
      .send(BYTES);

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/storage limit/);
  });
});

describe('GET /api/asset/usage', () => {
  it('reports used bytes, the rank limit, and the per-asset cap', async () => {
    prismaMock.asset.aggregate.mockResolvedValue({
      _sum: { size: 1234 }
    } as never);
    prismaMock.userRank.findUnique.mockResolvedValue({
      id: 1,
      assetByteLimit: 1000000
    } as never);

    const res = await request(app).get('/api/asset/usage');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      usedBytes: 1234,
      limitBytes: 1000000,
      maxAssetBytes: 2000000
    });
  });

  it('surfaces an unlimited budget (0) as null, not "0 remaining"', async () => {
    prismaMock.asset.aggregate.mockResolvedValue({
      _sum: { size: 0 }
    } as never);
    prismaMock.userRank.findUnique.mockResolvedValue({
      id: 1,
      assetByteLimit: 0
    } as never);

    const res = await request(app).get('/api/asset/usage');

    expect(res.body.limitBytes).toBeNull();
  });
});
