import { Prisma } from '@prisma/client';
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

  it('excludes bookmarks whose artist has been withdrawn (#573)', async () => {
    // A bookmark list is an artist list, so `Artist.deletedAt` applies. Asserts
    // the where-clause: the mock returns whatever it is told, so the payload
    // cannot prove the filter. Unfiltered, this handed back a name whose own
    // detail route answers 404 — a dead entry in the member's own list.
    prismaMock.bookmarkArtist.findMany.mockResolvedValue([] as never);

    await request(app).get('/api/bookmarks/artists');

    expect(prismaMock.bookmarkArtist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 7, artist: { deletedAt: null } }
      })
    );
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
    prismaMock.bookmarkArtist.deleteMany.mockResolvedValue({} as never);

    const res = await request(app).post('/api/bookmarks/artists/5');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookmarked: false });
    // deleteMany, not delete: see the arm-B case below.
    expect(prismaMock.bookmarkArtist.deleteMany).toHaveBeenCalled();
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

// ─── #564: a well-formed request must not answer 500 ─────────────────────────
//
// Parametrised across all four segments on purpose. The guard is hand-written
// four times, because extracting it into a helper would put the `try` outside
// the handler where the lexical guard-coverage checker cannot see it. Four
// copies means four chances to mistype one, so each is asserted rather than
// one being taken as representative.
const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });

describe.each([
  ['artists', 'artistId', 'bookmarkArtist', 'Artist'],
  ['releases', 'releaseId', 'bookmarkRelease', 'Release'],
  ['communities', 'communityId', 'bookmarkCommunity', 'Community'],
  ['requests', 'requestId', 'bookmarkRequest', 'Request']
] as const)(
  'POST /api/bookmarks/%s/:id — constraint handling (#564)',
  (segment, _param, model, label) => {
    const mock = () =>
      prismaMock[model as keyof typeof prismaMock] as never as {
        findUnique: jest.Mock;
        create: jest.Mock;
        deleteMany: jest.Mock;
      };

    it('answers 404, not 500, when the path id names nothing', async () => {
      // Arm A: a foreign-key violation carries no statusCode, so before #564
      // this surfaced as a 500 and was logged as an unhandled error.
      mock().findUnique.mockResolvedValue(null);
      mock().create.mockRejectedValue(prismaError('P2003'));

      const res = await request(app).post(`/api/bookmarks/${segment}/999999`);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ msg: `${label} not found` });
    });

    it('reports the resulting state when a concurrent POST wins the race', async () => {
      // The caller asked to bookmark and the bookmark exists, so a toggle
      // reports what is true now rather than a conflict.
      mock().findUnique.mockResolvedValue(null);
      mock().create.mockRejectedValue(prismaError('P2002'));

      const res = await request(app).post(`/api/bookmarks/${segment}/5`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ bookmarked: true });
    });

    it('removes with deleteMany, so a concurrent un-bookmark cannot 500', async () => {
      // Arm B: `delete` throws P2025 when the row went away between the read
      // and the write. deleteMany no-ops instead.
      mock().findUnique.mockResolvedValue({ userId: 7 } as never);
      mock().deleteMany.mockResolvedValue({ count: 0 } as never);

      const res = await request(app).post(`/api/bookmarks/${segment}/5`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ bookmarked: false });
      expect(mock().deleteMany).toHaveBeenCalled();
    });

    it('still propagates an error that is not a constraint violation', async () => {
      // The catch translates two codes and rethrows everything else; a guard
      // that swallowed the rest would hide real faults behind a 404.
      mock().findUnique.mockResolvedValue(null);
      mock().create.mockRejectedValue(new Error('connection lost'));

      const res = await request(app).post(`/api/bookmarks/${segment}/5`);

      expect(res.status).toBe(500);
    });
  }
);
