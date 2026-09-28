import { isRemoteImageSrc, remoteImageUrls } from './images';

describe('remoteImageUrls', () => {
  it('finds every [img] the renderer would draw, once each', () => {
    expect(
      remoteImageUrls(
        '[img]https://a.example/x.png[/img] and [b][img]http://b.example/y.JPG[/img][/b] ' +
          'again [img]https://a.example/x.png[/img]'
      )
    ).toEqual(['https://a.example/x.png', 'http://b.example/y.JPG']);
  });

  it('finds images nested in quotes and lists', () => {
    expect(
      remoteImageUrls(
        '[quote=someone|12][list][*][img]https://c.example/z.gif[/img][/list][/quote]'
      )
    ).toEqual(['https://c.example/z.gif']);
  });

  it('ignores what the renderer would not draw as an image', () => {
    expect(
      remoteImageUrls(
        '[img]/api/asset/abc.png[/img] [img]ftp://d.example/x.png[/img] ' +
          '[img]https://d.example/page.html[/img] https://e.example/bare.png ' +
          '[url]https://f.example/linked.png[/url]'
      )
    ).toEqual([]);
  });

  it('ignores an [img] inside a raw block, which renders as text', () => {
    expect(
      remoteImageUrls('[code][img]https://g.example/x.png[/img][/code]')
    ).toEqual([]);
  });

  it('handles empty input', () => {
    expect(remoteImageUrls('')).toEqual([]);
    expect(remoteImageUrls(null)).toEqual([]);
  });
});

describe('isRemoteImageSrc', () => {
  it.each([
    ['https://a.example/x.png', true],
    ['http://a.example/x.jpeg', true],
    ['https://a.example/x.webp', false],
    ['/api/asset/0123', false],
    ['javascript:alert(1)//.png', false]
  ])('%s -> %s', (src, expected) => {
    expect(isRemoteImageSrc(src)).toBe(expected);
  });
});
