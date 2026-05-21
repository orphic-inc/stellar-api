import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';

// ─── GET /api/search/releases ─────────────────────────────────────────────────

describe('GET /api/search/releases', () => {
  beforeEach(() => resetApiTestState());

  it('returns 200 with empty results and no params', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.release.count.mockResolvedValue(0);
    const res = await request(app).get('/api/search/releases');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: [], meta: { total: 0 } });
  });

  it('passes q through as OR across title, description, and artist', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.release.count.mockResolvedValue(0);
    await request(app).get('/api/search/releases?q=miles');
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              title: expect.objectContaining({ contains: 'miles' })
            })
          ])
        })
      })
    );
  });

  it('uses any-mode tag filter when tagMode=any', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.release.count.mockResolvedValue(0);
    await request(app).get('/api/search/releases?tags=jazz&tagMode=any');
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          releaseTags: { some: { tag: { name: { in: ['jazz'] } } } }
        })
      })
    );
  });

  it('uses AND array tag filter when tagMode=all', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.release.count.mockResolvedValue(0);
    await request(app).get('/api/search/releases?tags=jazz,blues&tagMode=all');
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            { releaseTags: { some: { tag: { name: 'jazz' } } } },
            { releaseTags: { some: { tag: { name: 'blues' } } } }
          ]
        })
      })
    );
  });

  it('filters by bitrate and media in contribution predicate', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.release.count.mockResolvedValue(0);
    await request(app).get('/api/search/releases?bitrate=320&media=CD');
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contributions: {
            some: expect.objectContaining({
              bitrate: { contains: '320', mode: 'insensitive' },
              media: { contains: 'CD', mode: 'insensitive' }
            })
          }
        })
      })
    );
  });

  it('filters by artist, recordLabel, catalogueNumber, and description fields', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.release.count.mockResolvedValue(0);
    await request(app).get(
      '/api/search/releases?artist=miles&recordLabel=columbia&catalogueNumber=CS8163&description=modal'
    );
    const call = prismaMock.release.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({
      artist: { name: { contains: 'miles', mode: 'insensitive' } },
      recordLabel: { contains: 'columbia', mode: 'insensitive' },
      catalogueNumber: { contains: 'CS8163', mode: 'insensitive' },
      description: { contains: 'modal', mode: 'insensitive' }
    });
  });

  it('adds contribution predicate when hasLog=true', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.release.count.mockResolvedValue(0);
    await request(app).get('/api/search/releases?hasLog=true');
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contributions: { some: { hasLog: true } }
        })
      })
    );
  });

  it('applies year bounds, multi-community filters, and vanityHouse artist filter', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.release.count.mockResolvedValue(0);
    await request(app).get(
      '/api/search/releases?year=1990&yearTo=1995&communityId=1&communityId=2&vanityHouse=true'
    );
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          year: { gte: 1990, lte: 1995 },
          communityId: { in: [1, 2] },
          artist: expect.objectContaining({ vanityHouse: true })
        })
      })
    );
  });

  it('uses yearTo upper bound when no year lower bound is provided', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.release.count.mockResolvedValue(0);
    await request(app).get('/api/search/releases?yearTo=1988');
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          year: { lte: 1988 }
        })
      })
    );
  });

  it('uses count then random skip when orderBy=random', async () => {
    prismaMock.release.count.mockResolvedValue(100);
    prismaMock.release.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/search/releases?orderBy=random');
    expect(res.status).toBe(200);
    expect(prismaMock.release.count).toHaveBeenCalledTimes(1);
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: expect.any(Number) })
    );
  });

  it('rejects an invalid orderBy value with 400', async () => {
    const res = await request(app).get('/api/search/releases?orderBy=invalid');
    expect(res.status).toBe(400);
  });

  it('wraps a single communityId in an array', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.release.count.mockResolvedValue(0);
    await request(app).get('/api/search/releases?communityId=5');
    const call = prismaMock.release.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({ communityId: { in: [5] } });
  });

  it('filters by format, hasCue, isScene, title, type, and releaseType', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.release.count.mockResolvedValue(0);
    await request(app).get(
      '/api/search/releases?format=flac&hasCue=true&isScene=true&title=blue&type=Music&releaseType=Album'
    );
    const call = prismaMock.release.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({
      title: { contains: 'blue', mode: 'insensitive' },
      type: 'Music',
      releaseType: 'Album'
    });
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contributions: {
            some: expect.objectContaining({
              type: 'flac',
              hasCue: true,
              isScene: true
            })
          }
        })
      })
    );
  });

  it('applies year lower bound without yearTo', async () => {
    prismaMock.release.findMany.mockResolvedValue([]);
    prismaMock.release.count.mockResolvedValue(0);
    await request(app).get('/api/search/releases?year=2000');
    const call = prismaMock.release.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({ year: { gte: 2000 } });
    expect((call?.where as Record<string, unknown>)?.year).not.toHaveProperty(
      'lte'
    );
  });

  it('uses skip=0 when count is within page limit for random ordering', async () => {
    prismaMock.release.count.mockResolvedValue(5);
    prismaMock.release.findMany.mockResolvedValue([]);
    await request(app).get('/api/search/releases?orderBy=random');
    expect(prismaMock.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 })
    );
  });
});

// ─── GET /api/search/artists ──────────────────────────────────────────────────

describe('GET /api/search/artists', () => {
  beforeEach(() => resetApiTestState());

  it('returns 200 with empty results and no params', async () => {
    prismaMock.artist.findMany.mockResolvedValue([]);
    prismaMock.artist.count.mockResolvedValue(0);
    const res = await request(app).get('/api/search/artists');
    expect(res.status).toBe(200);
  });

  it('filters by vanityHouse when vanityHouse=true', async () => {
    prismaMock.artist.findMany.mockResolvedValue([]);
    prismaMock.artist.count.mockResolvedValue(0);
    await request(app).get('/api/search/artists?vanityHouse=true');
    expect(prismaMock.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ vanityHouse: true })
      })
    );
  });

  it('uses ArtistTag relation in tag predicate when tagMode=any', async () => {
    prismaMock.artist.findMany.mockResolvedValue([]);
    prismaMock.artist.count.mockResolvedValue(0);
    await request(app).get('/api/search/artists?tags=jazz&tagMode=any');
    expect(prismaMock.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tags: { some: { tag: { name: { in: ['jazz'] } } } }
        })
      })
    );
  });

  it('uses AND array ArtistTag predicate when tagMode=all', async () => {
    prismaMock.artist.findMany.mockResolvedValue([]);
    prismaMock.artist.count.mockResolvedValue(0);
    await request(app).get('/api/search/artists?tags=jazz,blues&tagMode=all');
    expect(prismaMock.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            { tags: { some: { tag: { name: 'jazz' } } } },
            { tags: { some: { tag: { name: 'blues' } } } }
          ]
        })
      })
    );
  });

  it('uses count then random skip when orderBy=random', async () => {
    prismaMock.artist.count.mockResolvedValue(50);
    prismaMock.artist.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/search/artists?orderBy=random');
    expect(res.status).toBe(200);
    expect(prismaMock.artist.count).toHaveBeenCalledTimes(1);
    expect(prismaMock.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: expect.any(Number) })
    );
  });

  it('uses skip=0 when count is within page limit for random ordering', async () => {
    prismaMock.artist.count.mockResolvedValue(5);
    prismaMock.artist.findMany.mockResolvedValue([]);
    await request(app).get('/api/search/artists?orderBy=random');
    expect(prismaMock.artist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 })
    );
  });
});

// ─── GET /api/search/requests ─────────────────────────────────────────────────

describe('GET /api/search/requests', () => {
  beforeEach(() => resetApiTestState());

  it('returns 200 and always filters deleted requests', async () => {
    prismaMock.request.findMany.mockResolvedValue([]);
    prismaMock.request.count.mockResolvedValue(0);
    await request(app).get('/api/search/requests');
    expect(prismaMock.request.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null })
      })
    );
  });

  it('filters by status when status=open', async () => {
    prismaMock.request.findMany.mockResolvedValue([]);
    prismaMock.request.count.mockResolvedValue(0);
    await request(app).get('/api/search/requests?status=open');
    expect(prismaMock.request.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'open' })
      })
    );
  });

  it('filters request search by q, artist, type, year, and community', async () => {
    prismaMock.request.findMany.mockResolvedValue([]);
    prismaMock.request.count.mockResolvedValue(0);
    await request(app).get(
      '/api/search/requests?q=fusion&artist=herbie&type=Music&year=1974&communityId=12'
    );
    expect(prismaMock.request.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { title: { contains: 'fusion', mode: 'insensitive' } },
            { description: { contains: 'fusion', mode: 'insensitive' } }
          ],
          artists: {
            some: {
              artist: { name: { contains: 'herbie', mode: 'insensitive' } }
            }
          },
          type: 'Music',
          year: 1974,
          communityId: 12
        })
      })
    );
  });

  it('uses count then random skip for random request ordering', async () => {
    prismaMock.request.count.mockResolvedValue(100);
    prismaMock.request.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/search/requests?orderBy=random');
    expect(res.status).toBe(200);
    expect(prismaMock.request.count).toHaveBeenCalledTimes(1);
    expect(prismaMock.request.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: expect.any(Number), take: 25 })
    );
  });

  it('uses skip=0 when count is within page limit for random request ordering', async () => {
    prismaMock.request.count.mockResolvedValue(5);
    prismaMock.request.findMany.mockResolvedValue([]);
    await request(app).get('/api/search/requests?orderBy=random');
    expect(prismaMock.request.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 })
    );
  });

  it('serializes request totals and community info in search results', async () => {
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 44,
        title: 'Need live set',
        description: 'Audience tape wanted',
        type: 'Music',
        year: 1978,
        status: 'open',
        voteCount: 3,
        communityId: 12,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        user: { id: 7, username: 'alice' },
        community: { id: 12, name: 'Jazz Vault' },
        artists: [],
        bounties: [{ amount: BigInt(1048576) }, { amount: BigInt(512) }]
      }
    ] as never);
    prismaMock.request.count.mockResolvedValue(1);

    const res = await request(app).get('/api/search/requests');

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      totalBounty: '1049088',
      _count: { bounties: 2 },
      community: { id: 12, name: 'Jazz Vault' }
    });
  });

  it('rejects an invalid status with 400', async () => {
    const res = await request(app).get('/api/search/requests?status=bogus');
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/search/log ──────────────────────────────────────────────────────

describe('GET /api/search/log', () => {
  beforeEach(() => resetApiTestState());

  it('returns paginatedResponse shape and queries only topics when type=topic', async () => {
    prismaMock.forumTopic.findMany.mockResolvedValue([]);
    prismaMock.forumTopic.count.mockResolvedValue(0);
    const res = await request(app).get('/api/search/log?type=topic');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('meta');
    expect(prismaMock.forumPost.findMany).not.toHaveBeenCalled();
  });

  it('queries only posts when type=post', async () => {
    prismaMock.forumPost.findMany.mockResolvedValue([]);
    prismaMock.forumPost.count.mockResolvedValue(0);
    const res = await request(app).get('/api/search/log?type=post');
    expect(res.status).toBe(200);
    expect(prismaMock.forumTopic.findMany).not.toHaveBeenCalled();
  });

  it('returns both topics and posts sections when type=all', async () => {
    prismaMock.forumTopic.findMany.mockResolvedValue([]);
    prismaMock.forumTopic.count.mockResolvedValue(0);
    prismaMock.forumPost.findMany.mockResolvedValue([]);
    prismaMock.forumPost.count.mockResolvedValue(0);
    const res = await request(app).get('/api/search/log?type=all');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('topics');
    expect(res.body).toHaveProperty('posts');
    expect(res.body.topics).toHaveProperty('data');
    expect(res.body.posts).toHaveProperty('data');
  });

  it('defaults to type=all when no type param given', async () => {
    prismaMock.forumTopic.findMany.mockResolvedValue([]);
    prismaMock.forumTopic.count.mockResolvedValue(0);
    prismaMock.forumPost.findMany.mockResolvedValue([]);
    prismaMock.forumPost.count.mockResolvedValue(0);
    const res = await request(app).get('/api/search/log');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('topics');
    expect(res.body).toHaveProperty('posts');
  });

  it('applies q and authorId filters to both topic and post log searches', async () => {
    prismaMock.forumTopic.findMany.mockResolvedValue([]);
    prismaMock.forumTopic.count.mockResolvedValue(0);
    prismaMock.forumPost.findMany.mockResolvedValue([]);
    prismaMock.forumPost.count.mockResolvedValue(0);
    await request(app).get('/api/search/log?type=all&q=modal&authorId=44');
    expect(prismaMock.forumTopic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          title: { contains: 'modal', mode: 'insensitive' },
          authorId: 44
        }
      })
    );
    expect(prismaMock.forumPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          body: { contains: 'modal', mode: 'insensitive' },
          authorId: 44
        }
      })
    );
  });
});

// ─── GET /api/search/users ────────────────────────────────────────────────────

describe('GET /api/search/users', () => {
  beforeEach(() => resetApiTestState());

  it('returns 200 and uses public path (disabled:false filter) for non-privileged users', async () => {
    // Default makeUserRank() has empty permissions — non-privileged
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank({}));
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    const res = await request(app).get('/api/search/users');
    expect(res.status).toBe(200);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ disabled: false })
      })
    );
  });

  it('uses OR username/email filter for privileged users with users_search permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ users_search: true })
    );
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    await request(app).get('/api/search/users?q=kyle');
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ username: expect.anything() }),
            expect.objectContaining({ email: expect.anything() })
          ])
        })
      })
    );
  });

  it('applies disabled filter for staff when disabled=true', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ staff: true })
    );
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    await request(app).get('/api/search/users?disabled=true');
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ disabled: true })
      })
    );
  });

  it('uses username ordering and public select shape for non-privileged users', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank({}));
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    await request(app).get('/api/search/users?order=desc&page=2&limit=5&q=neo');
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          disabled: false,
          username: { contains: 'neo', mode: 'insensitive' }
        },
        orderBy: { username: 'desc' },
        skip: 5,
        take: 5,
        select: expect.objectContaining({
          id: true,
          username: true,
          userRank: expect.any(Object)
        })
      })
    );
  });

  it('uses privileged ordering and staff-only select fields when admin can search users', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    await request(app).get('/api/search/users?orderBy=lastLogin&order=asc');
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { lastLogin: 'asc' },
        select: expect.objectContaining({
          email: true,
          lastLogin: true,
          disabled: true,
          ratio: true,
          contributed: true,
          consumed: true
        })
      })
    );
  });

  it('treats null rank lookup as non-privileged', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(null);
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    const res = await request(app).get('/api/search/users');
    expect(res.status).toBe(200);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ disabled: false })
      })
    );
  });
});

// ─── GET /api/random/release ──────────────────────────────────────────────────

describe('GET /api/random/release', () => {
  beforeEach(() => resetApiTestState());

  it('returns a release with id and communityId', async () => {
    prismaMock.release.count.mockResolvedValue(10);
    prismaMock.release.findFirst.mockResolvedValue({
      id: 42,
      communityId: 1,
      title: 'Kind of Blue',
      year: 1959,
      artist: { id: 5, name: 'Miles Davis' }
    } as never);
    const res = await request(app).get('/api/random/release');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 42, communityId: 1 });
  });

  it('returns 404 when there are no releases', async () => {
    prismaMock.release.count.mockResolvedValue(0);
    const res = await request(app).get('/api/random/release');
    expect(res.status).toBe(404);
    expect(prismaMock.release.findFirst).not.toHaveBeenCalled();
  });
});

// ─── GET /api/random/artist ───────────────────────────────────────────────────

describe('GET /api/random/artist', () => {
  beforeEach(() => resetApiTestState());

  it('returns an artist with id and name', async () => {
    prismaMock.artist.count.mockResolvedValue(5);
    prismaMock.artist.findFirst.mockResolvedValue({
      id: 1,
      name: 'Miles Davis'
    } as never);
    const res = await request(app).get('/api/random/artist');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, name: 'Miles Davis' });
  });

  it('returns 404 when there are no artists', async () => {
    prismaMock.artist.count.mockResolvedValue(0);
    const res = await request(app).get('/api/random/artist');
    expect(res.status).toBe(404);
    expect(prismaMock.artist.findFirst).not.toHaveBeenCalled();
  });
});
