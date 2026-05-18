import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

const makeRelease = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Kind of Blue',
  year: 1959,
  image: null,
  communityId: 3,
  artist: { id: 10, name: 'Miles Davis' },
  ...overrides
});

const makeFeaturedAlbum = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  groupId: 1,
  title: 'Album of the Month',
  threadId: null,
  started: new Date('2026-01-01'),
  ended: new Date('2026-01-31'),
  ...overrides
});

beforeEach(() => resetApiTestState());

describe('GET /api/home/featured', () => {
  it('returns albumOfTheMonth and vanityHouse when both exist', async () => {
    const featured = makeFeaturedAlbum();
    const release = makeRelease();
    const vanityRelease = makeRelease({ id: 2, title: 'VH Album' });

    prismaMock.featuredAlbum.findFirst.mockResolvedValue(featured as never);
    prismaMock.release.findUnique.mockResolvedValue(release as never);
    prismaMock.release.findFirst.mockResolvedValue(vanityRelease as never);

    const res = await request(app).get('/api/home/featured');

    expect(res.status).toBe(200);
    expect(res.body.albumOfTheMonth).not.toBeNull();
    expect(res.body.albumOfTheMonth.title).toBe('Album of the Month');
    expect(res.body.vanityHouse.title).toBe('VH Album');
  });

  it('returns null albumOfTheMonth when no featured album', async () => {
    prismaMock.featuredAlbum.findFirst.mockResolvedValue(null);
    prismaMock.release.findFirst.mockResolvedValue(makeRelease() as never);

    const res = await request(app).get('/api/home/featured');

    expect(res.status).toBe(200);
    expect(res.body.albumOfTheMonth).toBeNull();
  });

  it('returns null vanityHouse when no vanity house release', async () => {
    prismaMock.featuredAlbum.findFirst.mockResolvedValue(null);
    prismaMock.release.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/home/featured');

    expect(res.status).toBe(200);
    expect(res.body.vanityHouse).toBeNull();
  });

  it('uses featuredAlbum.title when provided instead of release title', async () => {
    const featured = makeFeaturedAlbum({ title: 'Custom AOTM Title' });
    const release = makeRelease({ title: 'Original Title' });

    prismaMock.featuredAlbum.findFirst.mockResolvedValue(featured as never);
    prismaMock.release.findUnique.mockResolvedValue(release as never);
    prismaMock.release.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/home/featured');

    expect(res.status).toBe(200);
    expect(res.body.albumOfTheMonth.title).toBe('Custom AOTM Title');
  });

  it('falls back to release title when featuredAlbum.title is empty', async () => {
    const featured = makeFeaturedAlbum({ title: '' });
    const release = makeRelease({ title: 'The Real Title' });

    prismaMock.featuredAlbum.findFirst.mockResolvedValue(featured as never);
    prismaMock.release.findUnique.mockResolvedValue(release as never);
    prismaMock.release.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/home/featured');

    expect(res.status).toBe(200);
    expect(res.body.albumOfTheMonth.title).toBe('The Real Title');
  });
});
