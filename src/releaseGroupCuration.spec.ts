import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  setCurrentUserPermissions
} from './test/apiTestHarness';
import { identityKeyFor } from './modules/releaseGroup';

/**
 * ReleaseGroup curation verbs (#265 PR2) — merge, split, retitle, covers, log.
 *
 * Two things here are worth more than the rest.
 *
 * The **ordering test on merge**: `GroupLog.releaseGroupId` cascades, so
 * deleting the source group before its log rows are repointed destroys exactly
 * the history merge exists to preserve. Nothing about the response shape would
 * reveal that — only the call order does, and the harness runs interactive
 * transactions against the mock itself, so the order is observable.
 *
 * The **visibility tests**: merge and split reuse `resolveGroupForViewer`
 * rather than a moderator bypass, so holding `contributions_manage` does not
 * widen what you can see. That is PR1's boundary being inherited, not restated.
 */

const CURRENT_USER = 7;

const groupRow = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  title: 'Kind of Blue',
  year: 1959,
  artist: { id: 2, name: 'Miles Davis' },
  releases: [
    {
      id: 3,
      title: 'Kind of Blue',
      year: 1959,
      image: null,
      communityId: 1,
      community: { id: 1, name: 'Jazz' },
      credits: []
    }
  ],
  ...overrides
});

const asModerator = () =>
  setCurrentUserPermissions({ contributions_manage: true });

beforeEach(() => {
  resetApiTestState();
});

describe('POST /api/release-groups/:id/merge', () => {
  it('repoints the source log rows BEFORE deleting the source group', async () => {
    asModerator();
    prismaMock.releaseGroup.findFirst
      .mockResolvedValueOnce(groupRow({ id: 5 }) as never)
      .mockResolvedValueOnce(
        groupRow({ id: 9, title: 'Kind Of Blue' }) as never
      );
    prismaMock.release.updateMany.mockResolvedValue({ count: 2 } as never);
    prismaMock.coverArt.findMany.mockResolvedValue([] as never);
    prismaMock.coverArt.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.coverArt.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.groupLog.updateMany.mockResolvedValue({ count: 3 } as never);
    prismaMock.groupLog.create.mockResolvedValue({ id: 1 } as never);
    prismaMock.releaseGroup.delete.mockResolvedValue({ id: 9 } as never);
    prismaMock.auditLog.create.mockResolvedValue({ id: 1 } as never);

    const res = await request(app)
      .post('/api/release-groups/5/merge')
      .send({ sourceGroupId: 9 });

    expect(res.status).toBe(200);

    // GroupLog.releaseGroupId cascades on delete. Reverse these two and the
    // merged group's history is silently destroyed — with an identical
    // response body, which is why this asserts order and not payload.
    const repointed =
      prismaMock.groupLog.updateMany.mock.invocationCallOrder[0];
    const deleted = prismaMock.releaseGroup.delete.mock.invocationCallOrder[0];
    expect(repointed).toBeLessThan(deleted);
  });

  it('drops only the covers the target already carries, then repoints the rest', async () => {
    asModerator();
    prismaMock.releaseGroup.findFirst
      .mockResolvedValueOnce(groupRow({ id: 5 }) as never)
      .mockResolvedValueOnce(groupRow({ id: 9 }) as never);
    prismaMock.release.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.coverArt.findMany.mockResolvedValue([
      { image: 'https://img/a.jpg' }
    ] as never);
    prismaMock.coverArt.deleteMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.coverArt.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.groupLog.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.groupLog.create.mockResolvedValue({ id: 1 } as never);
    prismaMock.releaseGroup.delete.mockResolvedValue({ id: 9 } as never);
    prismaMock.auditLog.create.mockResolvedValue({ id: 1 } as never);

    await request(app)
      .post('/api/release-groups/5/merge')
      .send({ sourceGroupId: 9 });

    // Two groups being merged are likely to share artwork, and CoverArt is
    // unique on [releaseGroupId, image] — so the duplicate is dropped rather
    // than aborting the whole merge on a picture.
    expect(prismaMock.coverArt.deleteMany.mock.calls[0][0]?.where).toEqual({
      releaseGroupId: 9,
      image: { in: ['https://img/a.jpg'] }
    });
  });

  it('refuses to merge a group into itself, before touching the database', async () => {
    asModerator();
    const res = await request(app)
      .post('/api/release-groups/5/merge')
      .send({ sourceGroupId: 5 });

    expect(res.status).toBe(400);
    expect(prismaMock.releaseGroup.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.releaseGroup.delete).not.toHaveBeenCalled();
  });

  it('does not merge when the SOURCE is invisible to the actor', async () => {
    asModerator();
    prismaMock.releaseGroup.findFirst
      .mockResolvedValueOnce(groupRow({ id: 5 }) as never)
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/release-groups/5/merge')
      .send({ sourceGroupId: 9 });

    // contributions_manage says what you may DO, not what you may SEE.
    expect(res.status).toBe(404);
    expect(prismaMock.releaseGroup.delete).not.toHaveBeenCalled();
    expect(prismaMock.release.updateMany).not.toHaveBeenCalled();
  });

  it('does not merge when the TARGET is invisible to the actor', async () => {
    asModerator();
    prismaMock.releaseGroup.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/release-groups/5/merge')
      .send({ sourceGroupId: 9 });

    expect(res.status).toBe(404);
    expect(prismaMock.releaseGroup.delete).not.toHaveBeenCalled();
  });

  it('requires contributions_manage', async () => {
    // Default rank has no contributions_manage.
    const res = await request(app)
      .post('/api/release-groups/5/merge')
      .send({ sourceGroupId: 9 });

    expect(res.status).toBe(403);
    expect(prismaMock.releaseGroup.findFirst).not.toHaveBeenCalled();
  });
});

describe('POST /api/release-groups/:id/split', () => {
  const primeSplit = () => {
    prismaMock.releaseGroup.findFirst.mockResolvedValue(
      groupRow({ id: 5 }) as never
    );
    prismaMock.releaseGroup.findUnique.mockResolvedValue(null);
    prismaMock.releaseGroup.create.mockResolvedValue({
      id: 11,
      title: 'Blue Moods',
      year: 1955,
      artist: null
    } as never);
    prismaMock.groupLog.create.mockResolvedValue({ id: 1 } as never);
    prismaMock.auditLog.create.mockResolvedValue({ id: 1 } as never);
  };

  it('moves only releases that actually belong to the source group', async () => {
    asModerator();
    primeSplit();
    prismaMock.release.updateMany.mockResolvedValue({ count: 1 } as never);

    await request(app)
      .post('/api/release-groups/5/split')
      .send({ releaseIds: [3, 999], title: 'Blue Moods', year: 1955 });

    // The releaseGroupId arm is the guard: without it, a release id from any
    // other group would be quietly re-grouped by a caller who named it.
    expect(prismaMock.release.updateMany.mock.calls[0][0]?.where).toEqual({
      id: { in: [3, 999] },
      releaseGroupId: 5
    });
  });

  it('answers 400 when none of the named releases are in this group', async () => {
    asModerator();
    primeSplit();
    prismaMock.release.updateMany.mockResolvedValue({ count: 0 } as never);

    const res = await request(app)
      .post('/api/release-groups/5/split')
      .send({ releaseIds: [999], title: 'Blue Moods' });

    expect(res.status).toBe(400);
  });

  it('logs both sides of the split', async () => {
    asModerator();
    primeSplit();
    prismaMock.release.updateMany.mockResolvedValue({ count: 2 } as never);

    await request(app)
      .post('/api/release-groups/5/split')
      .send({ releaseIds: [3, 4], title: 'Blue Moods' });

    const logged = prismaMock.groupLog.create.mock.calls.map(
      (call) => (call[0]?.data as { releaseGroupId: number }).releaseGroupId
    );
    expect(logged).toEqual([5, 11]);
  });

  it('rejects an empty releaseIds list rather than writing two no-op log lines', async () => {
    asModerator();
    const res = await request(app)
      .post('/api/release-groups/5/split')
      .send({ releaseIds: [], title: 'Blue Moods' });

    expect(res.status).toBe(400);
    expect(prismaMock.release.updateMany).not.toHaveBeenCalled();
  });
});

describe('PUT /api/release-groups/:id — identity edits', () => {
  it('answers 409 naming the colliding group, and does not update', async () => {
    asModerator();
    prismaMock.releaseGroup.findFirst.mockResolvedValue(
      groupRow({ id: 5 }) as never
    );
    prismaMock.releaseGroup.findUnique.mockResolvedValue({ id: 77 } as never);

    const res = await request(app)
      .put('/api/release-groups/5')
      .send({ title: 'Something Else', year: 1958 });

    expect(res.status).toBe(409);
    expect(res.body.msg).toContain('#77');
    expect(prismaMock.releaseGroup.update).not.toHaveBeenCalled();
  });

  it('treats a rename onto its own identity as a no-op, writing no log entry', async () => {
    asModerator();
    prismaMock.releaseGroup.findFirst.mockResolvedValue(
      groupRow({ id: 5 }) as never
    );
    prismaMock.releaseGroup.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.artist.findUnique.mockResolvedValue({ id: 2 } as never);

    // Same identity as the resolved group: title "Kind of Blue", artist 2, 1959.
    const res = await request(app)
      .put('/api/release-groups/5')
      .send({ title: 'Kind of Blue', artistId: 2, year: 1959 });

    expect(res.status).toBe(200);
    expect(prismaMock.releaseGroup.update).not.toHaveBeenCalled();
    expect(prismaMock.groupLog.create).not.toHaveBeenCalled();
  });

  it('computes the current key from the artist ID, not the artist object', async () => {
    // Regression guard. The resolved group carries `artist: {id, name}`, not
    // `artistId`. Spreading it into identityKeyFor yields a key built with
    // artistId null, so every edit of an artist-citing group looked like a
    // change and rewrote the row.
    asModerator();
    prismaMock.releaseGroup.findFirst.mockResolvedValue(
      groupRow({ id: 5 }) as never
    );
    prismaMock.releaseGroup.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.artist.findUnique.mockResolvedValue({ id: 2 } as never);

    await request(app)
      .put('/api/release-groups/5')
      .send({ title: 'Kind of Blue', artistId: 2, year: 1959 });

    expect(prismaMock.releaseGroup.update).not.toHaveBeenCalled();
    // And the key it looked up is the artist-bearing one, not the null one.
    expect(prismaMock.releaseGroup.findUnique.mock.calls[0][0]?.where).toEqual({
      identityKey: identityKeyFor({
        title: 'Kind of Blue',
        artistId: 2,
        year: 1959
      })
    });
  });
});

describe('GET /api/release-groups/:id/log', () => {
  const primeLog = () => {
    prismaMock.releaseGroup.findFirst.mockResolvedValue(
      groupRow({ id: 5 }) as never
    );
    prismaMock.groupLog.findMany.mockResolvedValue([] as never);
    prismaMock.groupLog.count.mockResolvedValue(0 as never);
  };

  it('hides hidden rows from a member without contributions_manage', async () => {
    primeLog();
    await request(app).get('/api/release-groups/5/log');

    expect(prismaMock.groupLog.findMany.mock.calls[0][0]?.where).toEqual({
      releaseGroupId: 5,
      hidden: false
    });
  });

  it('shows hidden rows to a contributions_manage holder', async () => {
    asModerator();
    primeLog();
    await request(app).get('/api/release-groups/5/log');

    expect(prismaMock.groupLog.findMany.mock.calls[0][0]?.where).toEqual({
      releaseGroupId: 5
    });
  });

  it('404s for a group the viewer cannot resolve, without reading the log', async () => {
    prismaMock.releaseGroup.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/release-groups/5/log');

    expect(res.status).toBe(404);
    expect(prismaMock.groupLog.findMany).not.toHaveBeenCalled();
  });
});

describe('cover art', () => {
  const primeGroup = () =>
    prismaMock.releaseGroup.findFirst.mockResolvedValue(
      groupRow({ id: 5 }) as never
    );

  it('lets the member who added a cover remove it', async () => {
    primeGroup();
    prismaMock.coverArt.findFirst.mockResolvedValue({
      id: 8,
      userId: CURRENT_USER,
      image: 'https://img/a.jpg'
    } as never);
    prismaMock.coverArt.delete.mockResolvedValue({ id: 8 } as never);
    prismaMock.groupLog.create.mockResolvedValue({ id: 1 } as never);

    const res = await request(app).delete('/api/release-groups/5/covers/8');
    expect(res.status).toBe(204);
  });

  it("refuses to let a member remove someone else's cover", async () => {
    primeGroup();
    prismaMock.coverArt.findFirst.mockResolvedValue({
      id: 8,
      userId: 999,
      image: 'https://img/a.jpg'
    } as never);

    const res = await request(app).delete('/api/release-groups/5/covers/8');

    expect(res.status).toBe(403);
    expect(prismaMock.coverArt.delete).not.toHaveBeenCalled();
  });

  it("lets a contributions_manage holder remove someone else's cover", async () => {
    asModerator();
    primeGroup();
    prismaMock.coverArt.findFirst.mockResolvedValue({
      id: 8,
      userId: 999,
      image: 'https://img/a.jpg'
    } as never);
    prismaMock.coverArt.delete.mockResolvedValue({ id: 8 } as never);
    prismaMock.groupLog.create.mockResolvedValue({ id: 1 } as never);

    const res = await request(app).delete('/api/release-groups/5/covers/8');
    expect(res.status).toBe(204);
  });

  it('scopes the cover lookup to the group in the path', async () => {
    primeGroup();
    prismaMock.coverArt.findFirst.mockResolvedValue(null);

    await request(app).delete('/api/release-groups/5/covers/8');

    // Without the releaseGroupId arm, a cover id from any other group could be
    // deleted through a group the caller happens to be able to see.
    expect(prismaMock.coverArt.findFirst.mock.calls[0][0]?.where).toEqual({
      id: 8,
      releaseGroupId: 5
    });
  });

  it('rejects a non-https cover URL', async () => {
    primeGroup();
    const res = await request(app)
      .post('/api/release-groups/5/covers')
      .send({ image: 'http://img/a.jpg' });

    expect(res.status).toBe(400);
    expect(prismaMock.coverArt.create).not.toHaveBeenCalled();
  });

  it('requires the group to resolve before adding a cover', async () => {
    prismaMock.releaseGroup.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/release-groups/5/covers')
      .send({ image: 'https://img/a.jpg' });

    expect(res.status).toBe(404);
    expect(prismaMock.coverArt.create).not.toHaveBeenCalled();
  });
});
