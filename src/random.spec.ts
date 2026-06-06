import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

// ─── GET /api/random/release ──────────────────────────────────────────────────

describe('GET /api/random/release', () => {
  it('returns a random release', async () => {
    prismaMock.release.count.mockResolvedValue(5);
    prismaMock.release.findFirst.mockResolvedValue({
      id: 3,
      communityId: 1,
      title: 'Kind of Blue',
      year: 1959,
      credits: [{ role: 'Main', artist: { id: 7, name: 'Miles Davis' } }]
    } as never);

    const res = await request(app).get('/api/random/release');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(3);
    expect(res.body.title).toBe('Kind of Blue');
    expect(res.body.artist.name).toBe('Miles Davis');
  });

  it('returns 404 when there are no releases', async () => {
    prismaMock.release.count.mockResolvedValue(0);

    const res = await request(app).get('/api/random/release');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('No releases found');
  });
});

// ─── GET /api/random/artist ───────────────────────────────────────────────────

describe('GET /api/random/artist', () => {
  it('returns a random artist', async () => {
    prismaMock.artist.count.mockResolvedValue(10);
    prismaMock.artist.findFirst.mockResolvedValue({
      id: 4,
      name: 'Coltrane'
    } as never);

    const res = await request(app).get('/api/random/artist');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(4);
    expect(res.body.name).toBe('Coltrane');
  });

  it('returns 404 when there are no artists', async () => {
    prismaMock.artist.count.mockResolvedValue(0);

    const res = await request(app).get('/api/random/artist');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('No artists found');
  });
});
