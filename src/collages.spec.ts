import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';
import {
  makeCollage,
  makeCollageDetail,
  makeCollageEntry,
  makeCollageEntryDetail,
  makeRelease,
  makeCollageSubscription,
  makeBookmarkCollage,
  makeEntryAggregateResult,
  TEST_USER_ID
} from './test/factories';

const setStaffPerms = () =>
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({ collages_moderate: true })
  );

const COLLAGE_USER_ID = TEST_USER_ID; // matches harness injected user

describe('GET /api/collages', () => {
  beforeEach(() => resetApiTestState());

  it('returns paginated list excluding personal collages by default', async () => {
    prismaMock.collage.findMany.mockResolvedValue([makeCollage()]);
    prismaMock.collage.count.mockResolvedValue(1);

    const res = await request(app).get('/api/collages');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
    expect(prismaMock.collage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ categoryId: { gt: 0 } })
      })
    );
  });

  it('rejects invalid orderBy value with 400', async () => {
    const res = await request(app).get('/api/collages?orderBy=invalid');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/collages', () => {
  beforeEach(() => resetApiTestState());

  it('returns 201 with valid payload', async () => {
    prismaMock.collage.findFirst.mockResolvedValue(null);
    prismaMock.collage.create.mockResolvedValue(makeCollage());

    const res = await request(app)
      .post('/api/collages')
      .send({
        name: 'Test Collage',
        description: 'A sufficiently long description for testing purposes.',
        categoryId: 1,
        tags: ['jazz']
      });

    expect(res.status).toBe(201);
  });

  it('returns 409 when name already exists', async () => {
    prismaMock.collage.findFirst.mockResolvedValue(makeCollage());

    const res = await request(app).post('/api/collages').send({
      name: 'Test Collage',
      description: 'A sufficiently long description for testing purposes.'
    });

    expect(res.status).toBe(409);
    expect(prismaMock.collage.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/collages/:id', () => {
  beforeEach(() => resetApiTestState());

  it('returns 200 with subscription and bookmark state', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollageDetail({
        entries: [makeCollageEntryDetail()]
      }) as unknown as ReturnType<typeof makeCollage>
    );
    prismaMock.collageSubscription.findUnique.mockResolvedValue(null);
    prismaMock.bookmarkCollage.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/collages/1');

    expect(res.status).toBe(200);
    expect(res.body.isSubscribed).toBe(false);
    expect(res.body.isBookmarked).toBe(false);
    expect(res.body.entries).toHaveLength(1);
  });

  it('returns 404 for soft-deleted collage to non-staff', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollageDetail({
        isDeleted: true,
        entries: []
      }) as unknown as ReturnType<typeof makeCollage>
    );

    const res = await request(app).get('/api/collages/1');
    expect(res.status).toBe(404);
  });

  it('staff can view soft-deleted collage', async () => {
    setStaffPerms();
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollageDetail({
        isDeleted: true,
        entries: []
      }) as unknown as ReturnType<typeof makeCollage>
    );
    prismaMock.collageSubscription.findUnique.mockResolvedValue(null);
    prismaMock.bookmarkCollage.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/collages/1');
    expect(res.status).toBe(200);
  });

  it('returns 403 for personal collage owned by another user', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollageDetail({
        categoryId: 0,
        userId: 99,
        entries: []
      }) as unknown as ReturnType<typeof makeCollage>
    );

    const res = await request(app).get('/api/collages/1');
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/collages/:id', () => {
  beforeEach(() => resetApiTestState());

  it('owner can update description and tags', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(makeCollage());
    prismaMock.collage.update.mockResolvedValue(makeCollage());

    const res = await request(app)
      .put('/api/collages/1')
      .send({
        description: 'Updated description that is long enough.',
        tags: ['blues']
      });

    expect(res.status).toBe(200);
  });

  it('returns 403 when non-owner non-staff tries to update', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollage({ userId: 99 })
    );

    const res = await request(app)
      .put('/api/collages/1')
      .send({ description: 'Updated description that is long enough.' });

    expect(res.status).toBe(403);
    expect(prismaMock.collage.update).not.toHaveBeenCalled();
  });

  it('non-staff cannot rename a public collage', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollage({ categoryId: 1 })
    );

    const res = await request(app)
      .put('/api/collages/1')
      .send({ name: 'New Name', description: 'Long enough description here.' });

    expect(res.status).toBe(403);
  });

  it('staff can lock a collage', async () => {
    setStaffPerms();
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollage({ userId: 99 })
    );
    prismaMock.collage.update.mockResolvedValue(
      makeCollage({ isLocked: true })
    );

    const res = await request(app)
      .put('/api/collages/1')
      .send({ isLocked: true });

    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/collages/:id', () => {
  beforeEach(() => resetApiTestState());

  it('owner hard-deletes a personal collage (204)', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollage({ categoryId: 0 })
    );
    prismaMock.collage.delete.mockResolvedValue(makeCollage());

    const res = await request(app).delete('/api/collages/1');

    expect(res.status).toBe(204);
    expect(prismaMock.collage.delete).toHaveBeenCalledWith({
      where: { id: 1 }
    });
  });

  it('owner cannot delete a public collage (403)', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollage({ categoryId: 1 })
    );

    const res = await request(app).delete('/api/collages/1');

    expect(res.status).toBe(403);
  });

  it('staff soft-deletes a public collage (204)', async () => {
    setStaffPerms();
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollage({ userId: 99, categoryId: 1 })
    );
    prismaMock.collage.update.mockResolvedValue(makeCollage());

    const res = await request(app).delete('/api/collages/1');

    expect(res.status).toBe(204);
    expect(prismaMock.collage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDeleted: true })
      })
    );
  });
});

describe('POST /api/collages/:id/recover', () => {
  beforeEach(() => resetApiTestState());

  it('returns 403 for non-staff', async () => {
    const res = await request(app).post('/api/collages/1/recover');
    expect(res.status).toBe(403);
  });

  it('staff can recover a soft-deleted public collage', async () => {
    setStaffPerms();
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollage({ isDeleted: true, categoryId: 1 })
    );
    prismaMock.collage.update.mockResolvedValue(
      makeCollage({ isDeleted: false })
    );

    const res = await request(app).post('/api/collages/1/recover');

    expect(res.status).toBe(200);
    expect(prismaMock.collage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDeleted: false, deletedAt: null })
      })
    );
  });
});

describe('POST /api/collages/:id/entries', () => {
  beforeEach(() => resetApiTestState());

  it('returns 201 on successful add and uses aggregate sort', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(makeCollage());
    prismaMock.release.findUnique.mockResolvedValue(makeRelease());
    prismaMock.collageEntry.findUnique.mockResolvedValue(null);
    prismaMock.collageEntry.aggregate.mockResolvedValue(
      makeEntryAggregateResult(10)
    );
    prismaMock.$transaction.mockResolvedValue([makeCollageEntryDetail(), {}]);

    const res = await request(app)
      .post('/api/collages/1/entries')
      .send({ releaseId: 42 });

    expect(res.status).toBe(201);
    expect(prismaMock.collageEntry.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { collageId: 1 } })
    );
  });

  it('returns 409 when release is already in collage', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(makeCollage());
    prismaMock.release.findUnique.mockResolvedValue(makeRelease());
    prismaMock.collageEntry.findUnique.mockResolvedValue(makeCollageEntry());

    const res = await request(app)
      .post('/api/collages/1/entries')
      .send({ releaseId: 42 });

    expect(res.status).toBe(409);
  });

  it('returns 403 when collage is locked and user is not staff', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollage({ isLocked: true })
    );

    const res = await request(app)
      .post('/api/collages/1/entries')
      .send({ releaseId: 42 });

    expect(res.status).toBe(403);
  });

  it('returns 400 when maxEntries is reached', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollage({ maxEntries: 2, numEntries: 2 })
    );
    prismaMock.release.findUnique.mockResolvedValue(makeRelease());
    prismaMock.collageEntry.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/collages/1/entries')
      .send({ releaseId: 42 });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/collages/:id/entries/:releaseId', () => {
  beforeEach(() => resetApiTestState());

  it('collage owner can remove any entry (204)', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollage({ userId: COLLAGE_USER_ID })
    );
    prismaMock.collageEntry.findUnique.mockResolvedValue(
      makeCollageEntry({ userId: 99 })
    );
    prismaMock.$transaction.mockResolvedValue([{}, {}]);

    const res = await request(app).delete('/api/collages/1/entries/42');

    expect(res.status).toBe(204);
  });

  it('returns 403 when neither owner nor adder nor staff', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollage({ userId: 99 })
    );
    prismaMock.collageEntry.findUnique.mockResolvedValue(
      makeCollageEntry({ userId: 88 })
    );

    const res = await request(app).delete('/api/collages/1/entries/42');

    expect(res.status).toBe(403);
  });
});

describe('POST /api/collages/:id/subscribe', () => {
  beforeEach(() => resetApiTestState());

  it('subscribes when not already subscribed', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(makeCollage());
    prismaMock.collageSubscription.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockResolvedValue([{}, {}]);

    const res = await request(app).post('/api/collages/1/subscribe');

    expect(res.status).toBe(200);
    expect(res.body.subscribed).toBe(true);
  });

  it('unsubscribes when already subscribed', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(makeCollage());
    prismaMock.collageSubscription.findUnique.mockResolvedValue(
      makeCollageSubscription({ userId: COLLAGE_USER_ID, collageId: 1 })
    );
    prismaMock.$transaction.mockResolvedValue([{}, {}]);

    const res = await request(app).post('/api/collages/1/subscribe');

    expect(res.status).toBe(200);
    expect(res.body.subscribed).toBe(false);
  });
});

describe('POST /api/collages/:id/bookmark', () => {
  beforeEach(() => resetApiTestState());

  it('bookmarks when not already bookmarked', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(makeCollage());
    prismaMock.bookmarkCollage.findUnique.mockResolvedValue(null);
    prismaMock.bookmarkCollage.create.mockResolvedValue(makeBookmarkCollage());

    const res = await request(app).post('/api/collages/1/bookmark');

    expect(res.status).toBe(200);
    expect(res.body.bookmarked).toBe(true);
  });

  it('removes bookmark when already bookmarked', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(makeCollage());
    prismaMock.bookmarkCollage.findUnique.mockResolvedValue(
      makeBookmarkCollage({ userId: COLLAGE_USER_ID, collageId: 1 })
    );
    prismaMock.bookmarkCollage.delete.mockResolvedValue(makeBookmarkCollage());

    const res = await request(app).post('/api/collages/1/bookmark');

    expect(res.status).toBe(200);
    expect(res.body.bookmarked).toBe(false);
  });
});

describe('GET /api/collages/:id/subscriptions', () => {
  beforeEach(() => resetApiTestState());

  it('returns 403 for non-staff', async () => {
    const res = await request(app).get('/api/collages/1/subscriptions');
    expect(res.status).toBe(403);
  });

  it('staff can list subscribers', async () => {
    setStaffPerms();
    prismaMock.collage.findUnique.mockResolvedValue(makeCollage());
    prismaMock.collageSubscription.findUnique.mockResolvedValue(null);
    (
      prismaMock.collageSubscription as unknown as { findMany: jest.Mock }
    ).findMany = jest
      .fn()
      .mockResolvedValue([
        { id: 1, userId: 5, collageId: 1, user: { id: 5, username: 'bob' } }
      ]);

    const res = await request(app).get('/api/collages/1/subscriptions');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── Prisma contract tests ────────────────────────────────────────────────────
// These assert the exact Prisma call shapes the route makes, not real DB state.

describe('collages Prisma contract', () => {
  beforeEach(() => resetApiTestState());

  it('GET /:id calls collage.findUnique with the expected nested include shape', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollageDetail({ entries: [] }) as unknown as ReturnType<
        typeof makeCollage
      >
    );
    prismaMock.collageSubscription.findUnique.mockResolvedValue(null);
    prismaMock.bookmarkCollage.findUnique.mockResolvedValue(null);

    await request(app).get('/api/collages/1');

    expect(prismaMock.collage.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        include: expect.objectContaining({
          user: { select: { id: true, username: true, avatar: true } },
          _count: {
            select: { entries: true, subscriptions: true, bookmarks: true }
          },
          entries: expect.objectContaining({
            orderBy: { sort: 'asc' },
            include: expect.objectContaining({
              release: expect.objectContaining({
                select: expect.objectContaining({
                  id: true,
                  title: true,
                  artist: { select: { id: true, name: true } }
                })
              }),
              user: { select: { id: true, username: true } }
            })
          })
        })
      })
    );
  });

  it('POST /:id/entries wraps create + numEntries increment in one transaction', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(makeCollage());
    prismaMock.release.findUnique.mockResolvedValue(makeRelease());
    prismaMock.collageEntry.findUnique.mockResolvedValue(null);
    prismaMock.collageEntry.aggregate.mockResolvedValue(
      makeEntryAggregateResult(10)
    );
    prismaMock.$transaction.mockResolvedValue([makeCollageEntryDetail(), {}]);

    await request(app).post('/api/collages/1/entries').send({ releaseId: 42 });

    const txArgs = (prismaMock.$transaction as jest.Mock).mock
      .calls[0][0] as unknown[];
    expect(txArgs).toHaveLength(2);
  });
});
