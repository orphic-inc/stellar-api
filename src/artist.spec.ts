import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  createArtistMock,
  updateArtistMock,
  revertArtistFromHistoryMock
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

const setCommunityManage = () =>
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({ communities_manage: true })
  );

const makeArtist = (overrides = {}) => ({
  id: 1,
  name: 'Miles Davis',
  vanityHouse: false,
  description: null,
  createdAt: new Date('2026-01-01'),
  aliases: [],
  tags: [],
  similarTo: [],
  credits: [],
  _count: { credits: 3 },
  ...overrides
});

// ─── GET /api/artists ─────────────────────────────────────────────────────────

describe('GET /api/artists', () => {
  it('returns a paginated list of artists', async () => {
    prismaMock.artist.findMany.mockResolvedValue([makeArtist()] as never);
    prismaMock.artist.count.mockResolvedValue(1);

    const res = await request(app).get('/api/artists');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Miles Davis');
    expect(res.body.meta.total).toBe(1);
  });
});

// ─── GET /api/artists/history/:artistId ───────────────────────────────────────

describe('GET /api/artists/history/:artistId', () => {
  it('returns the edit history for an artist', async () => {
    prismaMock.artistHistory.findMany.mockResolvedValue([
      {
        id: 10,
        artistId: 1,
        name: 'Old Name',
        editedAt: new Date('2026-01-01'),
        editedUserId: 7,
        editedUser: { id: 7, username: 'editor' }
      }
    ] as never);

    const res = await request(app).get('/api/artists/history/1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Old Name');
  });

  it('returns 400 for a non-numeric artistId', async () => {
    const res = await request(app).get('/api/artists/history/abc');
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/artists/revert/:historyId ──────────────────────────────────────

describe('POST /api/artists/revert/:historyId', () => {
  beforeEach(() => setCommunityManage());

  it('reverts an artist to a previous history entry and returns the artist', async () => {
    revertArtistFromHistoryMock.mockResolvedValue(makeArtist() as never);

    const res = await request(app).post('/api/artists/revert/10');

    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('Artist reverted successfully');
    expect(res.body.artist.name).toBe('Miles Davis');
  });

  it('returns 404 when the history entry does not exist', async () => {
    revertArtistFromHistoryMock.mockResolvedValue(null as never);

    const res = await request(app).post('/api/artists/revert/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('History entry not found');
  });

  it('returns 403 without communities_manage permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app).post('/api/artists/revert/10');
    expect(res.status).toBe(403);
  });
});

// ─── POST /api/artists/similar ────────────────────────────────────────────────

describe('POST /api/artists/similar', () => {
  it('creates a similar-artist link and returns it', async () => {
    prismaMock.similarArtist.upsert.mockResolvedValue({
      artistId: 1,
      similarArtistId: 2,
      votes: [],
      score: 0
    } as never);

    const res = await request(app)
      .post('/api/artists/similar')
      .send({ artistId: 1, similarArtistId: 2 });

    expect(res.status).toBe(200);
    expect(res.body.artistId).toBe(1);
    expect(res.body.similarArtistId).toBe(2);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/artists/similar')
      .send({ artistId: 1 });
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/artists/alias ──────────────────────────────────────────────────

describe('POST /api/artists/alias', () => {
  it('creates an artist alias and returns 201', async () => {
    prismaMock.artistAlias.create.mockResolvedValue({
      id: 5,
      artistId: 1,
      redirectId: 2,
      userId: 7
    } as never);

    const res = await request(app)
      .post('/api/artists/alias')
      .send({ artistId: 1, redirectId: 2 });

    expect(res.status).toBe(201);
    expect(res.body.artistId).toBe(1);
    expect(res.body.redirectId).toBe(2);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/artists/alias')
      .send({ artistId: 1 });
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/artists/tag ────────────────────────────────────────────────────

describe('POST /api/artists/tag', () => {
  it('upserts an artist tag and returns it', async () => {
    prismaMock.artistTag.upsert.mockResolvedValue({
      artistId: 1,
      tagId: 3,
      userId: 7,
      positiveVotes: 1
    } as never);

    const res = await request(app)
      .post('/api/artists/tag')
      .send({ artistId: 1, tagId: 3 });

    expect(res.status).toBe(200);
    expect(res.body.artistId).toBe(1);
    expect(res.body.tagId).toBe(3);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/artists/tag')
      .send({ artistId: 1 });
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/artists ────────────────────────────────────────────────────────

describe('POST /api/artists', () => {
  it('creates an artist and returns 201', async () => {
    createArtistMock.mockResolvedValue(makeArtist() as never);

    const res = await request(app)
      .post('/api/artists')
      .send({ name: 'Miles Davis' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Miles Davis');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api/artists').send({});
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/artists/:id ─────────────────────────────────────────────────────

describe('GET /api/artists/:id', () => {
  const setupAccessMocks = () => {
    prismaMock.consumer.findUnique.mockResolvedValue({
      userId: 7,
      communities: [{ id: 1 }]
    } as never);
    prismaMock.contributor.findUnique.mockResolvedValue({
      userId: 7,
      communityId: 2
    } as never);
    prismaMock.community.findMany.mockResolvedValue([{ id: 3 }] as never);
  };

  it('returns an artist with community-filtered releases and isSubscribed false', async () => {
    setupAccessMocks();
    prismaMock.artist.findUnique.mockResolvedValue(makeArtist() as never);
    prismaMock.artistSubscription.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/artists/1');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Miles Davis');
    expect(res.body.isSubscribed).toBe(false);
  });

  it('returns isSubscribed true when the user follows the artist', async () => {
    setupAccessMocks();
    prismaMock.artist.findUnique.mockResolvedValue(makeArtist() as never);
    prismaMock.artistSubscription.findUnique.mockResolvedValue({
      id: 1,
      userId: 7,
      artistId: 1,
      createdAt: new Date()
    } as never);

    const res = await request(app).get('/api/artists/1');

    expect(res.status).toBe(200);
    expect(res.body.isSubscribed).toBe(true);
  });

  it('returns 404 when the artist does not exist', async () => {
    setupAccessMocks();
    prismaMock.artist.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/artists/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Artist not found');
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/api/artists/not-a-number');
    expect(res.status).toBe(400);
  });

  it('builds accessible community list when consumer and contributor are both null', async () => {
    prismaMock.consumer.findUnique.mockResolvedValue(null);
    prismaMock.contributor.findUnique.mockResolvedValue(null);
    prismaMock.community.findMany.mockResolvedValue([{ id: 5 }] as never);
    prismaMock.artist.findUnique.mockResolvedValue(makeArtist() as never);

    const res = await request(app).get('/api/artists/1');

    expect(res.status).toBe(200);
  });
});

// ─── GET /api/artists/:id/subscribe ──────────────────────────────────────────

describe('GET /api/artists/:id/subscribe', () => {
  it('returns subscribed false when not following', async () => {
    const res = await request(app).get('/api/artists/1/subscribe');
    expect(res.status).toBe(200);
    expect(res.body.subscribed).toBe(false);
  });

  it('returns subscribed true when following', async () => {
    prismaMock.artistSubscription.findUnique.mockResolvedValue({
      id: 1,
      userId: 7,
      artistId: 1,
      createdAt: new Date()
    } as never);

    const res = await request(app).get('/api/artists/1/subscribe');

    expect(res.status).toBe(200);
    expect(res.body.subscribed).toBe(true);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/api/artists/abc/subscribe');
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/artists/:id/subscribe ─────────────────────────────────────────

describe('POST /api/artists/:id/subscribe', () => {
  it('subscribes to an artist and returns subscribed true', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(makeArtist() as never);
    prismaMock.artistSubscription.upsert.mockResolvedValue({
      id: 1,
      userId: 7,
      artistId: 1,
      createdAt: new Date()
    } as never);

    const res = await request(app).post('/api/artists/1/subscribe');

    expect(res.status).toBe(200);
    expect(res.body.subscribed).toBe(true);
    expect(prismaMock.artistSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_artistId: { userId: 7, artistId: 1 } },
        create: { userId: 7, artistId: 1 }
      })
    );
  });

  it('returns 404 when the artist does not exist', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/artists/99/subscribe');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Artist not found');
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).post('/api/artists/abc/subscribe');
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/artists/:id/subscribe ───────────────────────────────────────

describe('DELETE /api/artists/:id/subscribe', () => {
  it('unsubscribes and returns subscribed false', async () => {
    prismaMock.artistSubscription.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app).delete('/api/artists/1/subscribe');

    expect(res.status).toBe(200);
    expect(res.body.subscribed).toBe(false);
    expect(prismaMock.artistSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7, artistId: 1 }
    });
  });

  it('returns 200 even when no subscription existed (idempotent)', async () => {
    prismaMock.artistSubscription.deleteMany.mockResolvedValue({ count: 0 });

    const res = await request(app).delete('/api/artists/1/subscribe');

    expect(res.status).toBe(200);
    expect(res.body.subscribed).toBe(false);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).delete('/api/artists/abc/subscribe');
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/artists/:id/similar ────────────────────────────────────────────

describe('GET /api/artists/:id/similar', () => {
  it('returns similar artists for the given id', async () => {
    prismaMock.similarArtist.findMany.mockResolvedValue([
      {
        artistId: 1,
        similarArtistId: 2,
        score: 5,
        similarArtist: { id: 2, name: 'John Coltrane' }
      }
    ] as never);

    const res = await request(app).get('/api/artists/1/similar');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].similarArtist.name).toBe('John Coltrane');
  });
});

// ─── PUT /api/artists/:id ─────────────────────────────────────────────────────

describe('PUT /api/artists/:id', () => {
  it('updates an artist and returns the updated record', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(makeArtist() as never);
    updateArtistMock.mockResolvedValue(
      makeArtist({ name: 'Miles Davis Jr.' }) as never
    );

    const res = await request(app)
      .put('/api/artists/1')
      .send({ name: 'Miles Davis Jr.' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Miles Davis Jr.');
  });

  it('returns 404 when the artist does not exist', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/artists/99')
      .send({ name: 'New Name' });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Artist not found');
  });
});

// ─── DELETE /api/artists/:id ──────────────────────────────────────────────────

describe('DELETE /api/artists/:id', () => {
  it('deletes an artist and returns 204', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(makeArtist() as never);
    prismaMock.artist.delete.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/artists/1');

    expect(res.status).toBe(204);
    expect(prismaMock.artist.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('returns 404 when the artist does not exist', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/artists/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Artist not found');
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).delete('/api/artists/abc');
    expect(res.status).toBe(400);
  });
});
