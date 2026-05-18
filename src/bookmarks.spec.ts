import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

// ─── Artist bookmarks ─────────────────────────────────────────────────────────

describe('GET /api/bookmarks/artists', () => {
  it('returns the list of artist bookmarks for the current user', async () => {
    prismaMock.bookmarkArtist.findMany.mockResolvedValue([
      {
        userId: 7,
        artistId: 5,
        createdAt: new Date('2026-01-01'),
        artist: { id: 5, name: 'Miles Davis' }
      } as never
    ]);

    const res = await request(app).get('/api/bookmarks/artists');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].artist.name).toBe('Miles Davis');
  });
});

describe('POST /api/bookmarks/artists/:artistId', () => {
  it('creates a bookmark when none exists and returns bookmarked: true', async () => {
    prismaMock.bookmarkArtist.findUnique.mockResolvedValue(null);
    prismaMock.bookmarkArtist.create.mockResolvedValue({} as never);

    const res = await request(app).post('/api/bookmarks/artists/5');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookmarked: true });
    expect(prismaMock.bookmarkArtist.create).toHaveBeenCalledWith({
      data: { userId: 7, artistId: 5 }
    });
  });

  it('removes an existing bookmark and returns bookmarked: false', async () => {
    prismaMock.bookmarkArtist.findUnique.mockResolvedValue({
      userId: 7,
      artistId: 5,
      createdAt: new Date()
    } as never);
    prismaMock.bookmarkArtist.delete.mockResolvedValue({} as never);

    const res = await request(app).post('/api/bookmarks/artists/5');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookmarked: false });
    expect(prismaMock.bookmarkArtist.delete).toHaveBeenCalled();
  });

  it('rejects non-numeric artistId with 400', async () => {
    const res = await request(app).post('/api/bookmarks/artists/notanumber');
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/bookmarks/artists/:artistId', () => {
  it('removes the bookmark and returns 204', async () => {
    prismaMock.bookmarkArtist.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app).delete('/api/bookmarks/artists/5');

    expect(res.status).toBe(204);
    expect(prismaMock.bookmarkArtist.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7, artistId: 5 }
    });
  });
});

// ─── Release bookmarks ────────────────────────────────────────────────────────

describe('GET /api/bookmarks/releases', () => {
  it('returns the list of release bookmarks for the current user', async () => {
    prismaMock.bookmarkRelease.findMany.mockResolvedValue([
      {
        userId: 7,
        releaseId: 42,
        createdAt: new Date('2026-01-01'),
        release: {
          id: 42,
          title: 'Kind of Blue',
          artist: { id: 5, name: 'Miles Davis' }
        }
      } as never
    ]);

    const res = await request(app).get('/api/bookmarks/releases');

    expect(res.status).toBe(200);
    expect(res.body[0].release.title).toBe('Kind of Blue');
  });
});

describe('POST /api/bookmarks/releases/:releaseId', () => {
  it('toggles a release bookmark on', async () => {
    prismaMock.bookmarkRelease.findUnique.mockResolvedValue(null);
    prismaMock.bookmarkRelease.create.mockResolvedValue({} as never);

    const res = await request(app).post('/api/bookmarks/releases/42');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookmarked: true });
  });

  it('toggles a release bookmark off', async () => {
    prismaMock.bookmarkRelease.findUnique.mockResolvedValue({
      userId: 7,
      releaseId: 42,
      createdAt: new Date()
    } as never);
    prismaMock.bookmarkRelease.delete.mockResolvedValue({} as never);

    const res = await request(app).post('/api/bookmarks/releases/42');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookmarked: false });
  });

  it('rejects non-numeric releaseId with 400', async () => {
    const res = await request(app).post('/api/bookmarks/releases/notanumber');
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/bookmarks/releases/:releaseId', () => {
  it('removes the release bookmark and returns 204', async () => {
    prismaMock.bookmarkRelease.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app).delete('/api/bookmarks/releases/42');

    expect(res.status).toBe(204);
    expect(prismaMock.bookmarkRelease.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7, releaseId: 42 }
    });
  });
});

// ─── Community bookmarks ──────────────────────────────────────────────────────

describe('GET /api/bookmarks/communities', () => {
  it('returns the list of community bookmarks for the current user', async () => {
    prismaMock.bookmarkCommunity.findMany.mockResolvedValue([
      {
        userId: 7,
        communityId: 3,
        createdAt: new Date('2026-01-01'),
        community: { id: 3, name: 'Jazz' }
      } as never
    ]);

    const res = await request(app).get('/api/bookmarks/communities');

    expect(res.status).toBe(200);
    expect(res.body[0].community.name).toBe('Jazz');
  });
});

describe('POST /api/bookmarks/communities/:communityId', () => {
  it('toggles a community bookmark on', async () => {
    prismaMock.bookmarkCommunity.findUnique.mockResolvedValue(null);
    prismaMock.bookmarkCommunity.create.mockResolvedValue({} as never);

    const res = await request(app).post('/api/bookmarks/communities/3');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookmarked: true });
  });

  it('toggles a community bookmark off', async () => {
    prismaMock.bookmarkCommunity.findUnique.mockResolvedValue({
      userId: 7,
      communityId: 3,
      createdAt: new Date()
    } as never);
    prismaMock.bookmarkCommunity.delete.mockResolvedValue({} as never);

    const res = await request(app).post('/api/bookmarks/communities/3');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookmarked: false });
  });
});

describe('DELETE /api/bookmarks/communities/:communityId', () => {
  it('removes the community bookmark and returns 204', async () => {
    prismaMock.bookmarkCommunity.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app).delete('/api/bookmarks/communities/3');

    expect(res.status).toBe(204);
    expect(prismaMock.bookmarkCommunity.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7, communityId: 3 }
    });
  });
});

// ─── Request bookmarks ────────────────────────────────────────────────────────

describe('GET /api/bookmarks/requests', () => {
  it('returns the list of request bookmarks for the current user', async () => {
    prismaMock.bookmarkRequest.findMany.mockResolvedValue([
      {
        userId: 7,
        requestId: 10,
        createdAt: new Date('2026-01-01'),
        request: { id: 10, title: 'Looking for Coltrane' }
      } as never
    ]);

    const res = await request(app).get('/api/bookmarks/requests');

    expect(res.status).toBe(200);
    expect(res.body[0].request.title).toBe('Looking for Coltrane');
  });
});

describe('POST /api/bookmarks/requests/:requestId', () => {
  it('toggles a request bookmark on', async () => {
    prismaMock.bookmarkRequest.findUnique.mockResolvedValue(null);
    prismaMock.bookmarkRequest.create.mockResolvedValue({} as never);

    const res = await request(app).post('/api/bookmarks/requests/10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookmarked: true });
  });

  it('toggles a request bookmark off', async () => {
    prismaMock.bookmarkRequest.findUnique.mockResolvedValue({
      userId: 7,
      requestId: 10,
      createdAt: new Date()
    } as never);
    prismaMock.bookmarkRequest.delete.mockResolvedValue({} as never);

    const res = await request(app).post('/api/bookmarks/requests/10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookmarked: false });
  });

  it('rejects non-numeric requestId with 400', async () => {
    const res = await request(app).post('/api/bookmarks/requests/notanumber');
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/bookmarks/requests/:requestId', () => {
  it('removes the request bookmark and returns 204', async () => {
    prismaMock.bookmarkRequest.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app).delete('/api/bookmarks/requests/10');

    expect(res.status).toBe(204);
    expect(prismaMock.bookmarkRequest.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7, requestId: 10 }
    });
  });
});
