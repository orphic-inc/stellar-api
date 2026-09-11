import { Prisma, RegistrationStatus } from '@prisma/client';
import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';
import {
  collapseByGroup,
  groupProjectionSelect,
  identityKeyFor,
  toGroupProjection
} from './modules/releaseGroup';

/**
 * ReleaseGroup — ADR-0023's one accepted leak surface (#265).
 *
 * The headline is the leak spec. Everything else here is ordinary coverage; the
 * `access filter` block is the reason this file exists.
 *
 * These tests assert the **where clause**, never the payload. A mock returns
 * whatever it is told, so a test that checks the response body proves only that
 * the mock was configured — it passes just as happily with the filter deleted.
 * Only the query proves the filter was applied.
 */

/**
 * The release scope the harness's current user (id 7) produces.
 *
 * Spelled out rather than imported from the module under test, for the reason
 * `search.spec.ts` gives at its own copy: importing it would compare the
 * function to itself and assert nothing. A change to the fragment's shape has
 * to be restated here deliberately.
 */
const VIEWER_SCOPE = {
  OR: [
    { communityId: null },
    {
      community: {
        OR: [
          { registrationStatus: 'open' },
          {
            OR: [
              { consumers: { some: { userId: 7 } } },
              { contributors: { some: { userId: 7 } } },
              { curators: { some: { id: 7 } } },
              { leaderId: 7 }
            ]
          }
        ]
      }
    }
  ]
};

const makeGroupRow = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  title: 'Kind of Blue',
  year: 1959,
  identityKey: '["kind of blue",2,1959]',
  artist: { id: 2, name: 'Miles Davis' },
  releases: [],
  ...overrides
});

beforeEach(() => {
  resetApiTestState();
});

describe('GET /api/release-groups/:id — the leak spec', () => {
  it('filters the group lookup itself, so an all-private group never resolves', async () => {
    prismaMock.releaseGroup.findFirst.mockResolvedValue(null);
    await request(app).get('/api/release-groups/5');

    const call = prismaMock.releaseGroup.findFirst.mock.calls[0][0];
    // Named separately from the member filter below: if only this one is
    // dropped, this test is the one that fails, and its name says which half.
    expect(call?.where).toEqual({
      id: 5,
      releases: { some: VIEWER_SCOPE }
    });
  });

  it('filters the member releases it returns, so siblings in unreachable communities are dropped', async () => {
    prismaMock.releaseGroup.findFirst.mockResolvedValue(
      makeGroupRow() as never
    );
    await request(app).get('/api/release-groups/5');

    const call = prismaMock.releaseGroup.findFirst.mock.calls[0][0];
    const releases = call?.include?.releases as { where?: unknown } | undefined;
    // The other half. Dropping this one alone would return every member of a
    // group the viewer can legitimately see one release in — the sibling-
    // existence leak ADR-0023 is written against.
    expect(releases?.where).toEqual(VIEWER_SCOPE);
  });

  it('applies the filter in BOTH positions, not just one', async () => {
    prismaMock.releaseGroup.findFirst.mockResolvedValue(
      makeGroupRow() as never
    );
    await request(app).get('/api/release-groups/5');

    const call = prismaMock.releaseGroup.findFirst.mock.calls[0][0];
    const inWhere = (call?.where as { releases?: { some?: unknown } })?.releases
      ?.some;
    const inInclude = (call?.include?.releases as { where?: unknown })?.where;
    expect(inWhere).toEqual(inInclude);
    expect(inWhere).toEqual(VIEWER_SCOPE);
  });

  it('answers 404 with the same message whether the group is absent or merely invisible', async () => {
    prismaMock.releaseGroup.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/release-groups/5');

    // Indistinguishable on purpose. A different status or message for the two
    // cases would make this an existence oracle for private catalogues.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Release group not found' });
  });

  it('never sends a permission or role into the query — there is no staff bypass', async () => {
    prismaMock.releaseGroup.findFirst.mockResolvedValue(null);
    await request(app).get('/api/release-groups/5');

    const serialized = JSON.stringify(
      prismaMock.releaseGroup.findFirst.mock.calls[0][0]
    );
    expect(serialized).not.toMatch(/permission|isStaff|admin/i);
  });

  it('requires a session', async () => {
    const res = await request(app)
      .get('/api/release-groups/5')
      .set('x-test-no-auth', '1');
    expect([401, 404]).toContain(res.status);
  });
});

describe('the release-facing projection (ADR-0037 §3)', () => {
  /**
   * The canonical-cover rule, pinned where it is stated rather than where it is
   * consumed. `CoverArt` has no primary flag, so "oldest wins" is a read-time
   * convention with nothing in the schema to enforce it — if this fragment
   * quietly stops taking one row, or takes the newest, every surface showing a
   * group changes at once and no other test would notice.
   */
  it('takes exactly one cover, oldest first', () => {
    expect(groupProjectionSelect.coverArt).toEqual({
      select: { image: true },
      orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
      take: 1
    });
  });

  it('selects identity and never the member releases', () => {
    // The sibling list is the half that stays behind `resolveGroupForViewer`.
    // Selecting `releases` here would route it around that filter entirely.
    expect(Object.keys(groupProjectionSelect).sort()).toEqual([
      'artist',
      'coverArt',
      'id',
      'title',
      'year'
    ]);
  });

  it('maps null to null, for the ungrouped release that is the common case', () => {
    expect(toGroupProjection(null)).toBeNull();
  });

  /**
   * `undefined` means a caller that did not select the relation, which is not
   * the same statement as "this release has no group" — but it has the same
   * right answer. Testing only for `null` made every release detail read a 500
   * against a projection that omits the relation.
   */
  it('maps undefined to null, for a caller that did not select the relation', () => {
    expect(toGroupProjection(undefined)).toBeNull();
  });

  it('carries the oldest cover as the image', () => {
    expect(
      toGroupProjection({
        id: 12,
        title: 'Kid A',
        year: 2000,
        artist: { id: 3, name: 'Radiohead' },
        coverArt: [{ image: 'https://example.test/oldest.jpg' }]
      })
    ).toEqual({
      id: 12,
      title: 'Kid A',
      year: 2000,
      artist: { id: 3, name: 'Radiohead' },
      image: 'https://example.test/oldest.jpg'
    });
  });

  it('is null-imaged when the group has no cover art', () => {
    expect(
      toGroupProjection({
        id: 12,
        title: 'Kid A',
        year: null,
        artist: null,
        coverArt: []
      })
    ).toMatchObject({ image: null, artist: null, year: null });
  });
});

describe('collapseByGroup (ADR-0037 §2)', () => {
  const group = (id: number, title: string) => ({
    id,
    title,
    year: 2000,
    artist: null,
    coverArt: []
  });

  const entry = (
    id: number,
    releaseId: number,
    userId: number,
    releaseGroup: ReturnType<typeof group> | null,
    communityId: number | null = 1
  ) => ({
    id,
    releaseId,
    userId,
    user: { id: userId, username: 'member' + userId },
    addedAt: new Date('2026-01-0' + id),
    sort: id * 10,
    release: {
      id: releaseId,
      title: 'Kid A',
      communityId,
      releaseGroup
    }
  });

  it('leaves ungrouped entries alone rather than folding them together', () => {
    // The `distinct` failure in miniature: every ungrouped release shares a
    // null group, so treating null as a key would collapse a whole collage
    // into one row.
    const out = collapseByGroup([
      entry(1, 100, 7, null),
      entry(2, 200, 7, null),
      entry(3, 300, 7, null)
    ]);
    expect(out).toHaveLength(3);
    expect(out.every((e) => e.group === null)).toBe(true);
    expect(out.every((e) => e.groupedWith.length === 0)).toBe(true);
  });

  it('collapses onto the FIRST occurrence and keeps the absorbed row addressable', () => {
    const g = group(12, 'Kid A');
    const out = collapseByGroup([
      entry(1, 100, 7, g, 3),
      entry(2, 200, 9, g, 7)
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
    // Everything delete and reorder need: `releaseId` keys the delete route,
    // `id` keys reorder, and `userId` is the per-row delete permission.
    expect(out[0].groupedWith).toEqual([
      {
        id: 2,
        releaseId: 200,
        communityId: 7,
        title: 'Kid A',
        userId: 9,
        user: { id: 9, username: 'member9' },
        addedAt: new Date('2026-01-02')
      }
    ]);
  });

  it("names the absorbed row's own adder, not the representative's (#617)", () => {
    // The whole point of carrying `user`: the two rows have DIFFERENT adders,
    // and a UI refusing the delete has to say whose copy is in the way. With
    // `userId` alone it could only count them.
    const g = group(12, 'Kid A');
    const out = collapseByGroup([entry(1, 100, 7, g), entry(2, 200, 9, g)]);

    expect(out[0].user).toEqual({ id: 7, username: 'member7' });
    expect(out[0].groupedWith[0].user).toEqual({ id: 9, username: 'member9' });
  });

  it('never emits the raw releaseGroup relation', () => {
    // The projection is the only shape of the group that may reach a response.
    const out = collapseByGroup([entry(1, 100, 7, group(12, 'Kid A'))]);
    expect(out[0].release).not.toHaveProperty('releaseGroup');
    expect(out[0].group).toMatchObject({ id: 12, title: 'Kid A', image: null });
  });

  it('preserves order and collapses only within a group', () => {
    const a = group(12, 'Kid A');
    const b = group(13, 'Amnesiac');
    const out = collapseByGroup([
      entry(1, 100, 7, a),
      entry(2, 200, 7, null),
      entry(3, 300, 7, b),
      entry(4, 400, 7, a)
    ]);
    expect(out.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(out[0].groupedWith.map((e) => e.id)).toEqual([4]);
    expect(out[1].groupedWith).toEqual([]);
    expect(out[2].groupedWith).toEqual([]);
  });
});

describe('identityKeyFor', () => {
  it('folds case, surrounding space and repeated inner space into one identity', () => {
    const a = identityKeyFor({
      title: 'Greatest Hits',
      artistId: 1,
      year: 1981
    });
    const b = identityKeyFor({
      title: '  greatest   HITS  ',
      artistId: 1,
      year: 1981
    });
    expect(a).toBe(b);
  });

  it('separates identities that differ only in artist or year', () => {
    const base = { title: 'Greatest Hits', artistId: 1, year: 1981 };
    expect(identityKeyFor(base)).not.toBe(
      identityKeyFor({ ...base, artistId: 2 })
    );
    expect(identityKeyFor(base)).not.toBe(
      identityKeyFor({ ...base, year: 1982 })
    );
  });

  it('treats absent artist and year as a distinct identity, not as a wildcard', () => {
    expect(identityKeyFor({ title: 'Untitled' })).toBe(
      identityKeyFor({ title: 'untitled', artistId: null, year: null })
    );
    expect(identityKeyFor({ title: 'Untitled' })).not.toBe(
      identityKeyFor({ title: 'Untitled', artistId: 1 })
    );
  });

  it('does not collide when the title contains the field separator', () => {
    // The reason this is JSON and not a `|` join: these two identities are
    // different and a hand-rolled join maps them onto one key.
    expect(
      identityKeyFor({ title: 'AC|DC', artistId: null, year: null })
    ).not.toBe(identityKeyFor({ title: 'AC', artistId: null, year: null }));
  });
});

describe('POST /api/release-groups — find-or-create', () => {
  it('returns 200 and the existing group when the identity already exists', async () => {
    prismaMock.releaseGroup.findUnique.mockResolvedValue(
      makeGroupRow() as never
    );
    const res = await request(app)
      .post('/api/release-groups')
      .send({ title: 'Kind of Blue', year: 1959 });

    expect(res.status).toBe(200);
    expect(prismaMock.releaseGroup.create).not.toHaveBeenCalled();
  });

  it('returns 201 and creates when the identity is new', async () => {
    prismaMock.releaseGroup.findUnique.mockResolvedValue(null);
    prismaMock.releaseGroup.create.mockResolvedValue(makeGroupRow() as never);
    const res = await request(app)
      .post('/api/release-groups')
      .send({ title: 'Kind of Blue', year: 1959 });

    expect(res.status).toBe(201);
    const data = prismaMock.releaseGroup.create.mock.calls[0][0]
      ?.data as Record<string, unknown>;
    expect(data.identityKey).toBe(
      identityKeyFor({ title: 'Kind of Blue', year: 1959 })
    );
  });

  it('never returns identityKey to the caller', async () => {
    prismaMock.releaseGroup.findUnique.mockResolvedValue(
      makeGroupRow() as never
    );
    const res = await request(app)
      .post('/api/release-groups')
      .send({ title: 'Kind of Blue', year: 1959 });

    expect(res.body).not.toHaveProperty('identityKey');
  });

  it('resolves a lost create race to the winner rather than failing', async () => {
    prismaMock.releaseGroup.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeGroupRow() as never);
    prismaMock.releaseGroup.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test'
      })
    );

    const res = await request(app)
      .post('/api/release-groups')
      .send({ title: 'Kind of Blue', year: 1959 });

    expect(res.status).toBe(200);
  });

  it('still propagates a non-constraint error', async () => {
    // Negative control: the P2002 arm must not swallow everything else.
    prismaMock.releaseGroup.findUnique.mockResolvedValue(null);
    prismaMock.releaseGroup.create.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .post('/api/release-groups')
      .send({ title: 'Kind of Blue', year: 1959 });

    expect(res.status).toBe(500);
  });

  it('answers 400 for an artistId that names no live artist', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/release-groups')
      .send({ title: 'Kind of Blue', artistId: 99, year: 1959 });

    expect(res.status).toBe(400);
    expect(prismaMock.releaseGroup.create).not.toHaveBeenCalled();
  });

  it('checks the artist for liveness, not merely existence', async () => {
    prismaMock.artist.findUnique.mockResolvedValue(null);
    await request(app)
      .post('/api/release-groups')
      .send({ title: 'Kind of Blue', artistId: 99, year: 1959 });

    // A soft-deleted artist keeps a live row, so a bare id lookup would let a
    // new group cite a withdrawn artist.
    expect(prismaMock.artist.findUnique.mock.calls[0][0]?.where).toEqual({
      id: 99,
      deletedAt: null
    });
  });
});

describe('PUT /api/communities/:communityId/releases/:releaseId/release-group', () => {
  const grantAccess = () =>
    prismaMock.community.findUnique.mockResolvedValue({
      registrationStatus: RegistrationStatus.open
    } as never);

  it('matches the release on its community, not on its id alone', async () => {
    grantAccess();
    prismaMock.release.findFirst.mockResolvedValue(null);

    await request(app)
      .put('/api/communities/1/releases/3/release-group')
      .send({ releaseGroupId: null });

    // Without the communityId arm, a caller with access to community A could
    // re-group a release belonging to private community B.
    expect(prismaMock.release.findFirst.mock.calls[0][0]?.where).toEqual({
      id: 3,
      communityId: 1
    });
  });

  it('answers 404 when the release is not in that community', async () => {
    grantAccess();
    prismaMock.release.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/communities/1/releases/3/release-group')
      .send({ releaseGroupId: null });

    expect(res.status).toBe(404);
    expect(prismaMock.release.update).not.toHaveBeenCalled();
  });

  it('answers 400 — not 404 — for a group id that does not exist', async () => {
    grantAccess();
    prismaMock.release.findFirst.mockResolvedValue({ id: 3 } as never);
    prismaMock.releaseGroup.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/communities/1/releases/3/release-group')
      .send({ releaseGroupId: 42 });

    // The route and the release both exist; it is the body value that does not.
    expect(res.status).toBe(400);
    expect(prismaMock.release.update).not.toHaveBeenCalled();
  });

  it('detaches on null without looking up a group', async () => {
    grantAccess();
    prismaMock.release.findFirst.mockResolvedValue({ id: 3 } as never);
    prismaMock.release.update.mockResolvedValue({
      id: 3,
      releaseGroupId: null
    } as never);

    const res = await request(app)
      .put('/api/communities/1/releases/3/release-group')
      .send({ releaseGroupId: null });

    expect(res.status).toBe(200);
    expect(prismaMock.releaseGroup.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.release.update.mock.calls[0][0]?.data).toEqual({
      releaseGroupId: null
    });
  });

  it('rejects a missing releaseGroupId rather than reading it as a detach', async () => {
    grantAccess();
    const res = await request(app)
      .put('/api/communities/1/releases/3/release-group')
      .send({});

    expect(res.status).toBe(400);
    expect(prismaMock.release.update).not.toHaveBeenCalled();
  });
});
