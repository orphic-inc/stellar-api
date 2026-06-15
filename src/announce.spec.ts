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

import {
  renderAnnounceRss,
  publishAnnounceItem,
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
});
