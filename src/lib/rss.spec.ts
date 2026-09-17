import { contributionItemTitle, escapeXml, renderRssChannel } from './rss';

jest.mock('../modules/config', () => ({
  email: { siteUrl: 'https://s.test' }
}));

const channel = { title: 'T', link: 'https://s.test', description: 'D' };
const item = {
  title: 'Title',
  link: 'https://s.test/releases/1',
  guid: 'stellar-contribution-1',
  pubDate: new Date('2026-09-01T00:00:00Z')
};

describe('renderRssChannel (#262)', () => {
  it('declares the Dublin Core namespace only when an item names a creator', () => {
    expect(renderRssChannel(channel, [item])).toContain('<rss version="2.0">');
    expect(
      renderRssChannel(channel, [{ ...item, creator: 'uploader' }])
    ).toContain(
      '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">'
    );
  });

  it('escapes an HTML description, so a reader receives it as text to render', () => {
    const xml = renderRssChannel(channel, [
      { ...item, description: '<p>Tom & "Jerry"</p>' }
    ]);
    expect(xml).toContain(
      '<description>&lt;p&gt;Tom &amp; &quot;Jerry&quot;&lt;/p&gt;</description>'
    );
  });

  it('escapes every text field, channel included', () => {
    const xml = renderRssChannel({ ...channel, title: 'A & B' }, [
      { ...item, title: '<x>', category: 'C & D', creator: 'E<F' }
    ]);
    expect(xml).toContain('<title>A &amp; B</title>');
    expect(xml).toContain('<title>&lt;x&gt;</title>');
    expect(xml).toContain('<category>C &amp; D</category>');
    expect(xml).toContain('<dc:creator>E&lt;F</dc:creator>');
  });
});

describe('contributionItemTitle', () => {
  it('credits artists when there are any', () => {
    expect(contributionItemTitle(['A', 'B'], 'T', 'flac')).toBe(
      'A, B — T [flac]'
    );
    expect(contributionItemTitle([], 'T', 'mp3')).toBe('T [mp3]');
  });
});

describe('escapeXml', () => {
  it('escapes all five XML specials', () => {
    expect(escapeXml(`<>&'"`)).toBe('&lt;&gt;&amp;&apos;&quot;');
  });
});
