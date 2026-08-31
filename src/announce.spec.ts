jest.mock('./modules/config', () => ({
  korin: { apiUrl: 'https://korin.test', pullKey: 'pk', pollIntervalMs: 1000 },
  email: { siteUrl: 'https://stellar.test' }
}));
jest.mock('./modules/logging', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const mockContributionFindMany = jest.fn();
jest.mock('./lib/prisma', () => ({
  prisma: { contribution: { findMany: mockContributionFindMany } }
}));

import {
  renderAnnounceRss,
  publishAnnounceItem,
  getNewAnnounceItems,
  announceTarget,
  AnnounceItem
} from './modules/announce';

const item: AnnounceItem = {
  id: 42,
  releaseId: 9,
  title: 'OK Computer',
  artists: ['Radiohead', 'Nigel & "friends"'],
  community: 'Music',
  communityId: 5,
  announceVisibility: 'PUBLIC',
  type: 'FLAC',
  createdAt: new Date('2026-06-15T00:00:00Z'),
  link: 'https://stellar.test/releases/9'
};

describe('renderAnnounceRss', () => {
  it('renders an RSS item with escaped, attributed title and link', () => {
    const xml = renderAnnounceRss([item]);
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain('https://stellar.test/releases/9');
    expect(xml).toContain('stellar-contribution-42');
    // artist names are joined and XML-escaped (&quot; for the embedded ")
    expect(xml).toContain(
      'Radiohead, Nigel &amp; &quot;friends&quot; — OK Computer [FLAC]'
    );
    expect(xml).toContain('<category>Music</category>');
  });
});

describe('publishAnnounceItem', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('POSTs a minimal RSS payload to korin /irc/announce with the pull key', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as never;

    const ok = await publishAnnounceItem(item);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://korin.test/irc/announce');
    expect(init.method).toBe('POST');
    expect(init.headers['x-pull-key']).toBe('pk');
    const body = JSON.parse(init.body);
    expect(body.templateType).toBe('minimal');
    expect(body.environment).toEqual({ osc8: false });
    expect(body.xmlPayload).toContain('stellar-contribution-42');
  });

  it('returns false on a non-2xx from korin', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 502 }) as never;
    expect(await publishAnnounceItem(item)).toBe(false);
  });

  // #299 — pin the exact wire contract korin's InboundFeedSchema accepts:
  // `{ xmlPayload: string, templateType: 'minimal', environment: { osc8: boolean } }`.
  // A drift here (extra/renamed field, wrong templateType) is a rejected push.
  it('sends exactly korin InboundFeedSchema keys with a plain (non-tokenized) link', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as never;

    await publishAnnounceItem(item);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual([
      'environment',
      'templateType',
      'xmlPayload'
    ]);
    expect(body.templateType).toBe('minimal');
    expect(Object.keys(body.environment)).toEqual(['osc8']);
    expect(typeof body.xmlPayload).toBe('string');
    // Notify-and-link (#136 / Golden Rule 3): the announce carries the release
    // page URL, never a tokenized one-shot download link.
    expect(body.xmlPayload).toContain('<link>https://stellar.test/releases/9');
    expect(body.xmlPayload).not.toMatch(/token|passkey|[?&]key=/i);
  });
});

describe('getNewAnnounceItems', () => {
  afterEach(() => mockContributionFindMany.mockReset());

  it('queries contributions strictly newer than the cursor, oldest first, capped', async () => {
    mockContributionFindMany.mockResolvedValue([]);
    await getNewAnnounceItems(42);

    const arg = mockContributionFindMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: { gt: 42 } });
    expect(arg.orderBy).toEqual({ id: 'asc' });
    expect(arg.take).toBe(50);
  });

  it('flattens the release/collaborator join into the AnnounceItem shape', async () => {
    mockContributionFindMany.mockResolvedValue([
      {
        id: 7,
        releaseId: 3,
        type: 'FLAC',
        createdAt: new Date('2026-06-15T00:00:00Z'),
        release: {
          title: 'Kid A',
          community: { id: 5, name: 'Music', announceVisibility: 'PRIVATE' }
        },
        collaborators: [{ name: 'Radiohead' }]
      }
    ]);

    const [out] = await getNewAnnounceItems(0);
    expect(out).toEqual({
      id: 7,
      releaseId: 3,
      title: 'Kid A',
      artists: ['Radiohead'],
      community: 'Music',
      communityId: 5,
      announceVisibility: 'PRIVATE',
      type: 'FLAC',
      createdAt: new Date('2026-06-15T00:00:00Z'),
      link: 'https://stellar.test/releases/3'
    });
  });

  it('maps a null community to null (no community join)', async () => {
    mockContributionFindMany.mockResolvedValue([
      {
        id: 8,
        releaseId: 4,
        type: 'MP3',
        createdAt: new Date('2026-06-16T00:00:00Z'),
        release: { title: 'Loner', community: null },
        collaborators: []
      }
    ]);

    const [out] = await getNewAnnounceItems(0);
    expect(out.community).toBeNull();
    expect(out.artists).toEqual([]);
  });
});

// ADR-0030 Decision 3 — the routing target. Two properties matter and are
// tested separately: that PRIVATE routes, and that everything else sends a body
// byte-identical to the pre-ADR-0030 one. The second is what makes the contract
// extension backward-compatible, and it is the easier of the two to break.
describe('announceTarget (ADR-0030 Decision 3)', () => {
  const withCommunity = (
    communityId: number | null,
    announceVisibility: AnnounceItem['announceVisibility']
  ): AnnounceItem => ({ ...item, communityId, announceVisibility });

  it('routes a PRIVATE community by numeric id, never by name', () => {
    const target = announceTarget(withCommunity(5, 'PRIVATE'));
    expect(target).toEqual({ visibility: 'PRIVATE', community: 5 });
  });

  it('omits `channel`, leaving korin to derive #c-<id>', () => {
    // The slot stays in the wire contract for a future admin-bound channel, but
    // stellar has no field to fill it from and must not invent one.
    expect(announceTarget(withCommunity(5, 'PRIVATE'))).not.toHaveProperty(
      'channel'
    );
  });

  it('sends no target for a PUBLIC community', () => {
    expect(announceTarget(withCommunity(5, 'PUBLIC'))).toBeUndefined();
  });

  it('sends no target for a contribution with no community', () => {
    expect(announceTarget(withCommunity(null, null))).toBeUndefined();
  });
});

describe('publishAnnounceItem target routing', () => {
  const bodyOf = (): Record<string, unknown> =>
    JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body as string
    ) as Record<string, unknown>;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  it('carries the target on a private announce', async () => {
    await publishAnnounceItem({
      ...item,
      communityId: 5,
      announceVisibility: 'PRIVATE'
    });
    expect(bodyOf().target).toEqual({ visibility: 'PRIVATE', community: 5 });
  });

  it('omits the target key entirely on a public announce', async () => {
    // Not `target: null` — omitted is the documented public path, and an
    // explicit null is a different value on the wire.
    await publishAnnounceItem({
      ...item,
      communityId: 5,
      announceVisibility: 'PUBLIC'
    });
    expect(bodyOf()).not.toHaveProperty('target');
  });

  it('leaves the rest of the push body unchanged', async () => {
    await publishAnnounceItem({
      ...item,
      communityId: 5,
      announceVisibility: 'PRIVATE'
    });
    const body = bodyOf();
    expect(body.templateType).toBe('minimal');
    expect(body.environment).toEqual({ osc8: false });
    expect(typeof body.xmlPayload).toBe('string');
  });
});
