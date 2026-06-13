import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

const mockSheet = {
  id: 1,
  authorId: 7,
  name: 'Midnight',
  source: 'body { background: #000; }',
  createdAt: new Date('2026-06-13T00:00:00Z'),
  updatedAt: new Date('2026-06-13T00:00:00Z')
};

// ─── POST /api/stylesheet/author ──────────────────────────────────────────────

describe('POST /api/stylesheet/author', () => {
  it('saves the authed user’s AuthorStylesheet (201)', async () => {
    prismaMock.authorStylesheet.upsert.mockResolvedValue(mockSheet as never);

    const res = await request(app)
      .post('/api/stylesheet/author')
      .send({ name: 'Midnight', source: 'body { background: #000; }' });

    expect(res.status).toBe(201);
    expect(res.body.authorId).toBe(7);
    expect(res.body.name).toBe('Midnight');
    // upsert keyed on the author → one per author.
    expect(prismaMock.authorStylesheet.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authorId: 7 } })
    );
  });

  it('rejects an empty name (400)', async () => {
    const res = await request(app)
      .post('/api/stylesheet/author')
      .send({ name: '', source: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing source (400)', async () => {
    const res = await request(app)
      .post('/api/stylesheet/author')
      .send({ name: 'Midnight' });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/stylesheet/author/:userId ───────────────────────────────────────

describe('GET /api/stylesheet/author/:userId', () => {
  it('returns an author’s stylesheet', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(
      mockSheet as never
    );

    const res = await request(app).get('/api/stylesheet/author/7');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('body { background: #000; }');
  });

  it('404s when the author has no stylesheet', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/stylesheet/author/999');
    expect(res.status).toBe(404);
  });

  it('rejects a non-numeric userId (400)', async () => {
    const res = await request(app).get('/api/stylesheet/author/notanumber');
    expect(res.status).toBe(400);
  });

  it('does not collide with GET /:id (author segment routed first)', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(
      mockSheet as never
    );
    const res = await request(app).get('/api/stylesheet/author/7');
    expect(res.status).toBe(200);
    // The site-stylesheet /:id handler must not have run.
    expect(prismaMock.stylesheet.findUnique).not.toHaveBeenCalled();
  });
});
