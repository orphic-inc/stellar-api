/**
 * The Member Feed routes (ADR-0014, #262).
 *
 * The feed OWNER here is member 9, and the harness's mocked session is member
 * 7. That gap is the point: a feed has no session, so every read must key on
 * the token's owner, and any code reaching for `req.user` shows up as a 7.
 *
 * Which rows reach a feed is memberFeeds.integration.ts's job, against a real
 * database. This file pins what a route decides: that every authentication
 * failure is one identical 404 before anything else runs, what a valid token
 * reads and with which filters, and what the response says about caching.
 * The limiters are mocked away in the harness; feedLimiters.spec.ts drives the
 * real ones.
 */
import {
  request,
  app,
  prismaMock,
  resetApiTestState
} from './test/apiTestHarness';
import { feeds } from './modules/config';
import { deriveFeedToken } from './modules/feedToken';
import { releaseVisibleTo } from './modules/communityAccess';

const OWNER = 9;
const SECRET = feeds.secret;
const token = () => deriveFeedToken(OWNER, 0);
const creds = () => `user=${OWNER}&token=${token()}`;

type FindManyArgs = {
  where: Record<string, unknown> & { release: { AND: unknown[] } };
  select: Record<string, unknown>;
  take: number;
};
const contributionQuery = () =>
  prismaMock.contribution.findMany.mock.calls[0][0] as unknown as FindManyArgs;

beforeEach(() => {
  resetApiTestState();
  feeds.secret = SECRET;
  // One row serves both reads that look a member up by id: the token check
  // (id, disabled, feedTokenEpoch) and the BBCode viewer (userSettings).
  prismaMock.user.findUnique.mockResolvedValue({
    id: OWNER,
    disabled: false,
    feedTokenEpoch: 0,
    userSettings: { showMatureContent: false }
  } as never);
  prismaMock.contribution.findMany.mockResolvedValue([]);
  prismaMock.news.findMany.mockResolvedValue([]);
  prismaMock.tagAlias.findUnique.mockResolvedValue(null);
});

afterAll(() => {
  feeds.secret = SECRET;
});

describe('Member Feed authentication', () => {
  const NOT_FOUND = { msg: 'Feed not found' };

  it.each([
    ['no credentials', () => ''],
    ['a missing token', () => `user=${OWNER}`],
    ['a malformed token', () => `user=${OWNER}&token=nope`],
    ['a repeated user param', () => `user=${OWNER}&user=10&token=${token()}`],
    ['a non-numeric user', () => `user=abc&token=${token()}`],
    [
      "another member's token",
      () => `user=${OWNER}&token=${deriveFeedToken(10, 0)}`
    ]
  ])('answers the same 404 for %s', async (_case, query) => {
    const res = await request(app).get(`/api/feeds/news.xml?${query()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(prismaMock.news.findMany).not.toHaveBeenCalled();
  });

  it('answers the same 404 for an unknown member', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app).get(`/api/feeds/mine.xml?${creds()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('answers the same 404 for a disabled member holding a valid token', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: OWNER,
      disabled: true,
      feedTokenEpoch: 0
    } as never);

    const res = await request(app).get(`/api/feeds/mine.xml?${creds()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(prismaMock.contribution.findMany).not.toHaveBeenCalled();
  });

  it('answers the same 404 on every feed while feeds are disabled', async () => {
    const query = creds();
    feeds.secret = '';

    for (const feed of ['contributions', 'mine', 'news', 'bookmarks']) {
      const res = await request(app).get(`/api/feeds/${feed}.xml?${query}`);
      expect([feed, res.status, res.body]).toEqual([feed, 404, NOT_FOUND]);
    }
  });

  it('checks the token before the filters, so a stranger never sees a 400', async () => {
    const res = await request(app).get(
      '/api/feeds/contributions.xml?user=9&token=nope&format=bogus'
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });
});

describe('GET /api/feeds/contributions.xml', () => {
  it("reads the owner's release scope, as RSS a reader may cache privately", async () => {
    const res = await request(app).get(
      `/api/feeds/contributions.xml?${creds()}`
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/rss+xml; charset=utf-8'
    );
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(res.text).toContain('<rss version="2.0">');

    const query = contributionQuery();
    // The owner's scope — not the session's (7), and not the public scope.
    expect(query.where.release.AND).toEqual([releaseVisibleTo(OWNER)]);
    expect(query.take).toBe(50);
    // Notify-and-link: nothing on the item could carry a download.
    expect(query.select).not.toHaveProperty('downloadUrl');
  });

  it('applies each filter, resolving a tag alias', async () => {
    prismaMock.tagAlias.findUnique.mockResolvedValue({
      goodTag: { name: 'electronic' }
    } as never);

    const res = await request(app).get(
      `/api/feeds/contributions.xml?${creds()}&community=4&tag=electronica&format=flac&bitrate=Lossless24`
    );

    expect(res.status).toBe(200);
    const { where } = contributionQuery();
    expect(where.release.AND).toEqual([
      releaseVisibleTo(OWNER),
      { communityId: 4 },
      { releaseTags: { some: { tag: { name: 'electronic' } } } }
    ]);
    expect(where.type).toBe('flac');
    expect(where.releaseFile).toEqual({ bitrate: 'Lossless24' });
  });

  it.each([
    ['an unknown format', 'format=bogus'],
    ['an unknown bitrate', 'bitrate=320'],
    ['a repeated tag', 'tag=a&tag=b'],
    ['a non-numeric community', 'community=music']
  ])('answers 400 for %s once the token is valid', async (_case, filter) => {
    const res = await request(app).get(
      `/api/feeds/contributions.xml?${creds()}&${filter}`
    );

    expect(res.status).toBe(400);
    expect(prismaMock.contribution.findMany).not.toHaveBeenCalled();
  });

  it('renders the uploader and links the release page', async () => {
    prismaMock.contribution.findMany.mockResolvedValue([
      {
        id: 42,
        releaseId: 5,
        type: 'flac',
        createdAt: new Date('2026-09-01T00:00:00Z'),
        user: { username: 'uploader' },
        release: { title: 'Album', community: { name: 'Music' } },
        collaborators: [{ name: 'Artist' }]
      }
    ] as never);

    const res = await request(app).get(
      `/api/feeds/contributions.xml?${creds()}`
    );

    expect(res.text).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
    expect(res.text).toContain('<title>Artist — Album [flac]</title>');
    expect(res.text).toContain('<link>http://localhost:3000/releases/5</link>');
    expect(res.text).toContain('<dc:creator>uploader</dc:creator>');
    expect(res.text).toContain('<category>Music</category>');
  });
});

describe('GET /api/feeds/mine.xml', () => {
  it("reads only the owner's contributions, still within their scope", async () => {
    const res = await request(app).get(`/api/feeds/mine.xml?${creds()}`);

    expect(res.status).toBe(200);
    const { where } = contributionQuery();
    expect(where.userId).toBe(OWNER);
    expect(where.release.AND).toEqual([releaseVisibleTo(OWNER)]);
  });
});

describe('GET /api/feeds/bookmarks.xml', () => {
  it("matches the owner's release and artist bookmarks, within their scope", async () => {
    const res = await request(app).get(`/api/feeds/bookmarks.xml?${creds()}`);

    expect(res.status).toBe(200);
    expect(contributionQuery().where.release.AND).toEqual([
      releaseVisibleTo(OWNER),
      {
        OR: [
          { bookmarks: { some: { userId: OWNER } } },
          {
            credits: {
              some: { artist: { bookmarks: { some: { userId: OWNER } } } }
            }
          }
        ]
      }
    ]);
  });
});

describe('GET /api/feeds/news.xml', () => {
  it('renders each body for the owner as viewer, and anchors the homepage item', async () => {
    prismaMock.news.findMany.mockResolvedValue([
      {
        id: 3,
        title: 'Maintenance',
        body: '[b]Down tonight[/b]',
        createdAt: new Date('2026-09-01T00:00:00Z')
      }
    ] as never);

    const res = await request(app).get(`/api/feeds/news.xml?${creds()}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('<link>http://localhost:3000/#news-3</link>');
    expect(res.text).toContain('stellar-news-3');
    // Rendered HTML, escaped into the element.
    expect(res.text).toMatch(/<description>&lt;\w+&gt;Down tonight/);
    // The viewer lookup is the owner's, never the session member's.
    const viewerLookups = prismaMock.user.findUnique.mock.calls.filter(
      ([args]) => 'userSettings' in ((args as { select: object }).select ?? {})
    );
    expect(viewerLookups).toEqual([
      [expect.objectContaining({ where: { id: OWNER } })]
    ]);
  });
});
