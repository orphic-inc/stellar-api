/**
 * #564 on /collages — the surface the issue named as its NEGATIVE control.
 *
 * The corrected rule on #564 says: "/collages yields nine candidates that are
 * all guarded by loadActiveCollage, so /collages is NOT affected." That was true
 * under the rule it replaced, which asked only whether an existence check ran.
 *
 * `loadActiveCollage` is `findUnique` + `throw new AppError(404)`. It is a READ.
 * It answers the ordinary case and leaves the window between itself and the
 * write, and #564's own report observed exactly that class of race. Under the
 * agreed rule the surface has seventeen affected sites, not zero.
 *
 * A separate spec file rather than an append: src/collages.spec.ts is already
 * past Codacy's 1000-line file limit.
 */
import { Prisma } from '@prisma/client';
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
  makeRelease,
  makeEntryAggregateResult,
  TEST_USER_ID
} from './test/factories';

const err = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test'
  });

/** The collage `loadActiveCollage` finds, owned by the acting user. */
const activeCollage = () =>
  makeCollage({
    id: 1,
    userId: TEST_USER_ID,
    isDeleted: false,
    isLocked: false
  });

beforeEach(() => {
  resetApiTestState();
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({ collages_moderate: true })
  );
});

describe('collages — a row that vanishes after loadActiveCollage (#564)', () => {
  it('PUT /collages/:id answers 404, not 500', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(activeCollage());
    prismaMock.collage.update.mockRejectedValue(err('P2025'));

    const res = await request(app)
      .put('/api/collages/1')
      .send({ description: 'a valid description' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Collage not found' });
  });

  it('POST /collages/:id/recover answers 404, not 500', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollage({ id: 1, isDeleted: true, categoryId: 1 })
    );
    prismaMock.collage.update.mockRejectedValue(err('P2025'));

    const res = await request(app).post('/api/collages/1/recover');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Collage not found' });
  });

  it('DELETE /collages/:id answers 404, not 500', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollage({ id: 1, userId: TEST_USER_ID, categoryId: 0 })
    );
    prismaMock.collage.delete.mockRejectedValue(err('P2025'));

    const res = await request(app).delete('/api/collages/1');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Collage not found' });
  });

  it('DELETE /collages/:id/entries/:releaseId answers 404, not 500', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(activeCollage());
    prismaMock.collageEntry.findUnique.mockResolvedValue(
      makeCollageEntry({ collageId: 1, releaseId: 2, userId: TEST_USER_ID })
    );
    prismaMock.$transaction.mockRejectedValue(err('P2025'));

    const res = await request(app).delete('/api/collages/1/entries/2');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Collage entry not found' });
  });
});

describe('collages — unique constraints answer 409, not 500 (#564)', () => {
  it('POST /collages on a duplicate name', async () => {
    // `Collage.name` carries a unique constraint, and the only foreign key is
    // the session-derived author — so P2002 is the one reachable code here.
    prismaMock.collage.create.mockRejectedValue(err('P2002'));

    const res = await request(app).post('/api/collages').send({
      name: 'Taken',
      description: 'a valid description',
      categoryId: 1
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      msg: 'A collage with that name already exists'
    });
  });
});

describe('collages — toggles report the resulting state (#564)', () => {
  // Same reading as the /bookmarks toggles: the caller asked to be subscribed
  // or bookmarked, and they are, so a lost race is not a conflict.
  it('POST /collages/:id/bookmark when a concurrent request won', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(activeCollage());
    prismaMock.bookmarkCollage.findUnique.mockResolvedValue(null);
    prismaMock.bookmarkCollage.create.mockRejectedValue(err('P2002'));

    const res = await request(app).post('/api/collages/1/bookmark');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookmarked: true });
  });

  it('POST /collages/:id/bookmark removes with deleteMany', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(activeCollage());
    prismaMock.bookmarkCollage.findUnique.mockResolvedValue({
      userId: TEST_USER_ID,
      collageId: 1
    } as never);
    prismaMock.bookmarkCollage.deleteMany.mockResolvedValue({
      count: 1
    } as never);

    const res = await request(app).post('/api/collages/1/bookmark');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookmarked: false });
    expect(prismaMock.bookmarkCollage.deleteMany).toHaveBeenCalled();
  });

  it('POST /collages/:id/subscribe when a concurrent request won', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(activeCollage());
    prismaMock.collageSubscription.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockRejectedValue(err('P2002'));

    const res = await request(app).post('/api/collages/1/subscribe');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subscribed: true });
  });

  it('POST /collages/:id/subscribe when a concurrent unsubscribe won', async () => {
    prismaMock.collage.findUnique.mockResolvedValue(activeCollage());
    prismaMock.collageSubscription.findUnique.mockResolvedValue({
      userId: TEST_USER_ID,
      collageId: 1
    } as never);
    prismaMock.$transaction.mockRejectedValue(err('P2025'));

    const res = await request(app).post('/api/collages/1/subscribe');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subscribed: false });
  });
});

describe('collages — reads and reorders (#564)', () => {
  it('GET /collages/:id touches lastVisit with updateMany, so it cannot 500', async () => {
    // A best-effort side effect on a READ. `update` would raise P2025 if the
    // subscription went away, failing a request that only asked to read.
    // The detail read uses a rich `include`, so the flat collage factory is not
    // enough — a thin mock 500s on serialisation and would prove nothing.
    prismaMock.collage.findUnique.mockResolvedValue(
      makeCollageDetail({ id: 1, isDeleted: false })
    );
    prismaMock.collageSubscription.findUnique.mockResolvedValue({
      userId: TEST_USER_ID,
      collageId: 1
    } as never);
    prismaMock.bookmarkCollage.findUnique.mockResolvedValue(null);
    prismaMock.collageEntry.findMany.mockResolvedValue([]);
    prismaMock.collageSubscription.updateMany.mockResolvedValue({
      count: 1
    } as never);

    const res = await request(app).get('/api/collages/1');

    expect(res.status).toBe(200);
    expect(prismaMock.collageSubscription.updateMany).toHaveBeenCalled();
    expect(prismaMock.collageSubscription.update).not.toHaveBeenCalled();
  });

  it('PUT /collages/:id/entries answers 400 when an entry id names nothing', async () => {
    // The entry ids come from the BODY and none is read first, so this is the
    // one site on the surface that is not merely a race.
    prismaMock.collage.findUnique.mockResolvedValue(activeCollage());
    prismaMock.$transaction.mockRejectedValue(err('P2025'));

    const res = await request(app)
      .put('/api/collages/1/entries')
      .send({ entries: [{ id: 999999, sort: 10 }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ msg: 'One or more entries not found' });
  });
});

describe('collages — POST /collages/:id/entries (#564)', () => {
  const primeEntryAdd = () => {
    prismaMock.collage.findUnique.mockResolvedValue(activeCollage());
    prismaMock.release.findFirst.mockResolvedValue(makeRelease({ id: 2 }));
    prismaMock.collageEntry.findUnique.mockResolvedValue(null);
    prismaMock.collageEntry.count.mockResolvedValue(0);
    prismaMock.collageEntry.aggregate.mockResolvedValue(
      makeEntryAggregateResult(0)
    );
  };

  it('answers 404 when the release or collage went away', async () => {
    primeEntryAdd();
    prismaMock.$transaction.mockRejectedValue(err('P2003'));

    const res = await request(app)
      .post('/api/collages/1/entries')
      .send({ releaseId: 2 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Collage or release not found' });
  });

  it('answers 409 when the entry was added concurrently', async () => {
    primeEntryAdd();
    prismaMock.$transaction.mockRejectedValue(err('P2002'));

    const res = await request(app)
      .post('/api/collages/1/entries')
      .send({ releaseId: 2 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ msg: 'Release already in collage' });
  });

  it('still propagates an error that is not a constraint violation', async () => {
    primeEntryAdd();
    prismaMock.$transaction.mockRejectedValue(new Error('connection lost'));

    const res = await request(app)
      .post('/api/collages/1/entries')
      .send({ releaseId: 2 });

    expect(res.status).toBe(500);
  });
});
