import { Prisma } from '@prisma/client';
import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  createArtistMock,
  updateArtistMock,
  revertArtistFromHistoryMock,
  setCurrentUserPermissions
} from './test/apiTestHarness';
import { releaseVisibleToViewer } from './modules/communityAccess';

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

// `assertArtistLive` (#573) reads artist.findUnique on every by-id route, so
// the default is a LIVE artist and each withdrawn-artist test overrides it with
// null. Without a default the guard would 404 every pre-existing test, which is
// exactly what it did when first wired — nine failures, each named.
beforeEach(() => {
  prismaMock.artist.findUnique.mockResolvedValue(makeArtist() as never);
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
    prismaMock.community.findMany.mockResolvedValue([
      { id: 1 },
      { id: 3 }
    ] as never);
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

  it('filters credits with the shared release predicate (#419, ADR-0036 §2)', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(makeArtist() as never);

    const res = await request(app).get('/api/artists/1');

    expect(res.status).toBe(200);

    // Referencing the predicate rather than rebuilding it is safe here BECAUSE
    // its exact shape is pinned independently, against a spelled-out literal,
    // in modules/communityAccess.spec.ts. What this asserts is that the route
    // applies THAT function rather than a filter of its own.
    expect(prismaMock.artist.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          credits: expect.objectContaining({
            where: { release: releaseVisibleToViewer(7) }
          })
        })
      })
    );
  });

  it('no longer pre-queries the accessible community ids', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(makeArtist() as never);

    await request(app).get('/api/artists/1');

    // The hand-rolled `communityId: { in: [...] }` list this replaced cost an
    // extra query AND excluded a NULL relation, so a release belonging to no
    // community vanished from every discography. Asserting the query is GONE
    // is what stops it coming back by reflex.
    expect(prismaMock.community.findMany).not.toHaveBeenCalled();
  });

  it('keeps community-less releases in the discography', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(makeArtist() as never);

    await request(app).get('/api/artists/1');

    const call = prismaMock.artist.findUnique.mock.calls[0][0];
    const where = (
      call?.include?.credits as { where?: { release?: { OR?: unknown[] } } }
    )?.where;
    // The regression this fixes, asserted at the point it reaches Prisma.
    expect(where?.release?.OR).toContainEqual({ communityId: null });
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

describe('withdrawn artists are excluded from discovery (#509 F3)', () => {
  // A soft delete is only worth the column if every discovery read honours it.
  // These assert the where-clause rather than the payload, because the mock
  // returns whatever it is told — only the query proves the filter is applied.
  it('filters the artist list and its total', async () => {
    prismaMock.artist.findMany.mockResolvedValue([] as never);
    prismaMock.artist.count.mockResolvedValue(0 as never);

    await request(app).get('/api/artists');

    expect(prismaMock.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } })
    );
    expect(prismaMock.artist.count).toHaveBeenCalledWith({
      where: { deletedAt: null }
    });
  });

  it('filters the vanity-house list alongside its own predicate', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
    prismaMock.artist.findMany.mockResolvedValue([] as never);
    prismaMock.artist.count.mockResolvedValue(0 as never);

    await request(app).get('/api/artists/vanity-house');

    expect(prismaMock.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { vanityHouse: true, deletedAt: null }
      })
    );
  });

  it('treats a withdrawn artist as absent on the detail read', async () => {
    prismaMock.community.findMany.mockResolvedValue([] as never);
    prismaMock.artist.findUnique.mockResolvedValue(null);
    prismaMock.artistSubscription.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/artists/1');

    expect(res.status).toBe(404);
    expect(prismaMock.artist.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, deletedAt: null } })
    );
  });
});

describe('PUT /api/artists/:id', () => {
  // #509 F3: an artist row is a shared catalogue entry with no ownership
  // concept, so this was `requireAuth`-only and authorized nothing.
  beforeEach(() => setCommunityManage());

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

  it('answers 403 without communities_manage', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank({}));

    const res = await request(app)
      .put('/api/artists/1')
      .send({ name: 'Miles Davis Jr.' });

    expect(res.status).toBe(403);
    expect(updateArtistMock).not.toHaveBeenCalled();
  });

  it('does not let vanityHouse in around the news_manage gate', async () => {
    // The bypass this fix closes: `PUT /:id/vanity-house` requires
    // news_manage, and this route writes the same field. A caller with
    // neither key must not reach it through here.
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank({}));

    const res = await request(app)
      .put('/api/artists/1')
      .send({ vanityHouse: true });

    expect(res.status).toBe(403);
    expect(updateArtistMock).not.toHaveBeenCalled();
  });

  it('treats a withdrawn artist as absent', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/artists/1')
      .send({ name: 'New Name' });

    expect(res.status).toBe(404);
    expect(prismaMock.artist.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, deletedAt: null } })
    );
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
  const setAdmin = () =>
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );

  beforeEach(() => setAdmin());

  it('soft-deletes an artist and returns 204', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(makeArtist() as never);
    prismaMock.artist.update.mockResolvedValue({} as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/artists/1');

    expect(res.status).toBe(204);
    // A hard delete could never have succeeded: every artist relation is
    // ON DELETE RESTRICT and createArtist writes a history row at creation.
    expect(prismaMock.artist.delete).not.toHaveBeenCalled();
    expect(prismaMock.artist.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { deletedAt: expect.any(Date) }
    });
  });

  it('answers 403 without admin', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ communities_manage: true })
    );

    const res = await request(app).delete('/api/artists/1');

    // communities_manage edits an artist but must not withdraw one.
    expect(res.status).toBe(403);
    expect(prismaMock.artist.update).not.toHaveBeenCalled();
  });

  it('is idempotent — a withdrawn artist reads as absent', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/artists/1');

    expect(res.status).toBe(404);
    expect(prismaMock.artist.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, deletedAt: null } })
    );
    expect(prismaMock.artist.update).not.toHaveBeenCalled();
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

// ─── #600: the body validation answers the envelope it publishes ─────────────
//
// This route hand-rolled `vanityHouseSchema.safeParse(req.body)` and answered a
// bare `{ msg: 'vanityHouse (boolean) required' }` — the last such branch in the
// repo, against 130 `validate()` call sites. Its own operation declares the 400
// as `ValidationError`, where `errors` is REQUIRED, so the handler contradicted
// the spec it publishes. The fix is `validate(vanityHouseSchema)`; these pin the
// envelope so the branch cannot quietly regress to a single message again.
describe('artists — vanity-house body validation (#600)', () => {
  beforeEach(() => {
    setCurrentUserPermissions({ news_manage: true });
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ news_manage: true })
    );
  });

  it('answers the field-level envelope, not a single message', async () => {
    const res = await request(app)
      .put('/api/artists/1/vanity-house')
      .send({ vanityHouse: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      msg: 'Validation failed',
      errors: { vanityHouse: expect.arrayContaining([expect.any(String)]) }
    });
    expect(prismaMock.artist.update).not.toHaveBeenCalled();
  });

  it('rejects a missing body before it reads the artist', async () => {
    const res = await request(app).put('/api/artists/1/vanity-house').send({});

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty('vanityHouse');
    expect(prismaMock.artist.update).not.toHaveBeenCalled();
  });
});

// ─── #564: constraint violations must not answer 500 ─────────────────────────
//
// Six sites on this surface, against a queue entry of three. The three the
// issue named are here; so are the vanity-house update, the subscribe upsert
// and the soft delete, none of which it listed.
const prismaErr = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });

describe('artists — constraint handling (#564)', () => {
  beforeEach(() => {
    setCurrentUserPermissions({
      news_manage: true,
      communities_manage: true,
      admin: true
    });
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ news_manage: true, communities_manage: true, admin: true })
    );
  });

  describe('a PATH id that names nothing answers 404', () => {
    it('PUT /artists/:id/vanity-house', async () => {
      prismaMock.artist.findUnique.mockResolvedValue({ id: 1 } as never);
      prismaMock.artist.update.mockRejectedValue(prismaErr('P2025'));

      const res = await request(app)
        .put('/api/artists/1/vanity-house')
        .send({ vanityHouse: true });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ msg: 'Artist not found' });
    });

    it('POST /artists/:id/subscribe', async () => {
      prismaMock.artist.findUnique.mockResolvedValue({ id: 1 } as never);
      prismaMock.artistSubscription.upsert.mockRejectedValue(
        prismaErr('P2003')
      );

      const res = await request(app).post('/api/artists/1/subscribe');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ msg: 'Artist not found' });
    });

    it('DELETE /artists/:id', async () => {
      prismaMock.artist.findUnique.mockResolvedValue({
        id: 1,
        name: 'x'
      } as never);
      prismaMock.artist.update.mockRejectedValue(prismaErr('P2025'));

      const res = await request(app).delete('/api/artists/1');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ msg: 'Artist not found' });
    });
  });

  describe('a BODY id that names nothing answers 400', () => {
    // 400 rather than 404: the route exists, and the payload is what refers to
    // something absent. P2003 does not say WHICH foreign key failed, so each
    // message names both candidates rather than guessing.
    it('POST /artists/similar', async () => {
      prismaMock.similarArtist.upsert.mockRejectedValue(prismaErr('P2003'));

      const res = await request(app)
        .post('/api/artists/similar')
        .send({ artistId: 1, similarArtistId: 999999 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ msg: 'Artist or similar artist not found' });
    });

    it('POST /artists/alias', async () => {
      prismaMock.artistAlias.create.mockRejectedValue(prismaErr('P2003'));

      const res = await request(app)
        .post('/api/artists/alias')
        .send({ artistId: 1, redirectId: 999999 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ msg: 'Artist or redirect target not found' });
    });

    it('POST /artists/tag', async () => {
      prismaMock.artistTag.upsert.mockRejectedValue(prismaErr('P2003'));

      const res = await request(app)
        .post('/api/artists/tag')
        .send({ artistId: 1, tagId: 999999 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ msg: 'Artist or tag not found' });
    });
  });

  describe('a lost unique race answers 409', () => {
    // Unlike the /bookmarks toggle, these are not idempotent: the tag upsert
    // increments a vote, so a lost race silently under-counts. 409 tells the
    // caller to retry rather than reporting a success that did not happen.
    it('POST /artists/similar', async () => {
      prismaMock.similarArtist.upsert.mockRejectedValue(prismaErr('P2002'));

      const res = await request(app)
        .post('/api/artists/similar')
        .send({ artistId: 1, similarArtistId: 2 });

      expect(res.status).toBe(409);
    });

    it('POST /artists/tag', async () => {
      prismaMock.artistTag.upsert.mockRejectedValue(prismaErr('P2002'));

      const res = await request(app)
        .post('/api/artists/tag')
        .send({ artistId: 1, tagId: 2 });

      expect(res.status).toBe(409);
    });
  });

  it('still propagates an error that is not a constraint violation', async () => {
    prismaMock.artistTag.upsert.mockRejectedValue(new Error('connection lost'));

    const res = await request(app)
      .post('/api/artists/tag')
      .send({ artistId: 1, tagId: 2 });

    expect(res.status).toBe(500);
  });
});

// ─── #573 — the relation half of the same invariant ──────────────────────────

describe('withdrawn artists do not surface through relations (#573)', () => {
  // #509 F3 above covers the DIRECT reads. These cover the reads that reach an
  // artist through a join row, which that sweep missed. As above, they assert
  // the QUERY: the mock returns whatever it is told, so only the where-clause
  // proves a filter is applied.

  it('filters the target of a similar-artist list, and checks the parent', async () => {
    prismaMock.similarArtist.findMany.mockResolvedValue([] as never);

    await request(app).get('/api/artists/1/similar');

    expect(prismaMock.similarArtist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { artistId: 1, similarArtist: { deletedAt: null } }
      })
    );
  });

  it('404s a withdrawn artists own similar list', async () => {
    // The direction filtering the target alone cannot fix: the parent was
    // never read at all, so the list stayed served for a withdrawn artist.
    prismaMock.artist.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/artists/1/similar');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Artist not found');
    expect(prismaMock.similarArtist.findMany).not.toHaveBeenCalled();
  });

  it('filters both artist-valued relations on the detail read', async () => {
    prismaMock.community.findMany.mockResolvedValue([] as never);
    prismaMock.artistSubscription.findUnique.mockResolvedValue(null);

    await request(app).get('/api/artists/1');

    const call = prismaMock.artist.findUnique.mock.calls[0][0] as {
      include: {
        aliases: { where: unknown };
        similarTo: { where: unknown };
        tags: Record<string, unknown>;
      };
    };
    expect(call.include.aliases.where).toEqual({
      redirect: { deletedAt: null }
    });
    expect(call.include.similarTo.where).toEqual({
      similarArtist: { deletedAt: null }
    });
    // tags resolve a Tag, not an Artist — deliberately unfiltered.
    expect(call.include.tags).not.toHaveProperty('where');
  });

  it('404s the history of a withdrawn artist, whose snapshots carry its name', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/artists/history/1');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Artist not found');
    expect(prismaMock.artistHistory.findMany).not.toHaveBeenCalled();
  });

  it('404s both subscribe reads for a withdrawn artist, as POST already did', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(null);

    const get = await request(app).get('/api/artists/1/subscribe');
    const del = await request(app).delete('/api/artists/1/subscribe');

    expect(get.status).toBe(404);
    expect(del.status).toBe(404);
    expect(prismaMock.artistSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps unsubscribing idempotent for a LIVE artist with no subscription', async () => {
    // The gate is on the artist, not the subscription — 404 here would break
    // the idempotence DELETE already promised.
    prismaMock.artistSubscription.deleteMany.mockResolvedValue({
      count: 0
    } as never);

    const res = await request(app).delete('/api/artists/1/subscribe');

    expect(res.status).toBe(200);
    expect(res.body.subscribed).toBe(false);
  });

  it('refuses to record a similarity pointing at a withdrawn artist', async () => {
    // Same status and wording as the route's P2003 arm: a body id that names
    // no usable artist gets one answer, whichever kind of unusable it is.
    prismaMock.artist.findUnique
      .mockResolvedValueOnce(makeArtist() as never)
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/artists/similar')
      .send({ artistId: 1, similarArtistId: 2 });

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Artist or similar artist not found');
    expect(prismaMock.similarArtist.upsert).not.toHaveBeenCalled();
  });

  it('refuses to record an alias pointing at a withdrawn artist', async () => {
    prismaMock.artist.findUnique
      .mockResolvedValueOnce(makeArtist() as never)
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/artists/alias')
      .send({ artistId: 1, redirectId: 2 });

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Artist or redirect target not found');
    expect(prismaMock.artistAlias.create).not.toHaveBeenCalled();
  });

  it('still propagates a non-constraint error from a guarded write', async () => {
    // The negative control every guard spec in this repo carries: proves the
    // assertions above pass because the GUARD fired, not because the route
    // happens to fail for any reason at all.
    prismaMock.similarArtist.upsert.mockRejectedValue(
      new Error('connection reset') as never
    );

    const res = await request(app)
      .post('/api/artists/similar')
      .send({ artistId: 1, similarArtistId: 2 });

    expect(res.status).toBe(500);
  });
});
