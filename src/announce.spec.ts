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
  AnnounceItem
} from './modules/announce';

const item: AnnounceItem = {
  id: 42,
  releaseId: 9,
  title: 'OK Computer',
  artists: ['Radiohead', 'Nigel & "friends"'],
  community: 'Music',
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
        release: { title: 'Kid A', community: { name: 'Music' } },
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
