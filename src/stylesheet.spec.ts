import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

const makeStylesheet = (overrides = {}) => ({
  id: 1,
  name: 'Dark Theme',
  cssUrl: 'https://example.com/dark.css',
  createdAt: new Date('2026-01-01'),
  ...overrides
});

// ─── GET /api/stylesheet ──────────────────────────────────────────────────────

describe('GET /api/stylesheet', () => {
  it('returns the list of stylesheets', async () => {
    prismaMock.stylesheet.findMany.mockResolvedValue([
      makeStylesheet(),
      makeStylesheet({ id: 2, name: 'Light Theme' })
    ] as never);

    const res = await request(app).get('/api/stylesheet');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('Dark Theme');
  });

  it('returns an empty array when no stylesheets exist', async () => {
    prismaMock.stylesheet.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/stylesheet');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

// ─── GET /api/stylesheet/:id ──────────────────────────────────────────────────

describe('GET /api/stylesheet/:id', () => {
  it('returns a stylesheet by id', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(
      makeStylesheet() as never
    );

    const res = await request(app).get('/api/stylesheet/1');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Dark Theme');
    expect(res.body.cssUrl).toBe('https://example.com/dark.css');
  });

  it('returns 404 when the stylesheet does not exist', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/stylesheet/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Stylesheet not found');
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/api/stylesheet/not-a-number');
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/stylesheet ─────────────────────────────────────────────────────

describe('POST /api/stylesheet', () => {
  it('creates a stylesheet and returns 201', async () => {
    prismaMock.stylesheet.create.mockResolvedValue(makeStylesheet() as never);

    const res = await request(app)
      .post('/api/stylesheet')
      .send({ name: 'Dark Theme', cssUrl: 'https://example.com/dark.css' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Dark Theme');
    expect(prismaMock.stylesheet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'Dark Theme', cssUrl: 'https://example.com/dark.css' }
      })
    );
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/stylesheet')
      .send({ name: 'Dark Theme' }); // missing cssUrl

    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/stylesheet/:id ───────────────────────────────────────────────

describe('DELETE /api/stylesheet/:id', () => {
  it('deletes a stylesheet and returns 204', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(
      makeStylesheet() as never
    );
    prismaMock.stylesheet.delete.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/stylesheet/1');

    expect(res.status).toBe(204);
    expect(prismaMock.stylesheet.delete).toHaveBeenCalledWith({
      where: { id: 1 }
    });
  });

  it('returns 404 when the stylesheet does not exist', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/stylesheet/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Stylesheet not found');
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).delete('/api/stylesheet/abc');
    expect(res.status).toBe(400);
  });
});
