import { BBCtx } from './ctx';
import { parse } from './parse';
import { render } from './render';
import { ResolveMaps } from './resolve';
import { tokenize } from './tokenize';

// Avoid pulling isomorphic-dompurify (jsdom ESM) through index.ts → sanitizeConfig;
// the escaping done by the emitter is the real defense we assert here, and the
// server sanitize is a second net exercised at the route/integration level.
jest.mock('./sanitizeConfig', () => ({ sanitizeBBCode: (v: string) => v }));

// eslint-disable-next-line import/first, @typescript-eslint/no-var-requires
import { renderBBCode } from './index';

const SITE = 'https://stellar.test';

const emptyMaps = (): ResolveMaps => ({
  usersById: new Map(),
  usersByName: new Map(),
  artistsByName: new Map(),
  releasesById: new Map(),
  wikisByRef: new Map(),
  postsById: new Map()
});

// The pure pipeline (no DB, no cache, no sanitize) for the non-DB tags.
const bb = (src: string): string =>
  render(parse(tokenize(src)), emptyMaps(), {
    db: {} as BBCtx['db'],
    siteUrl: SITE
  });

describe('bbcode — inline formatting', () => {
  const cases: [string, string, string][] = [
    [
      'bold',
      '[b]This is bold text.[/b]',
      '<strong>This is bold text.</strong>'
    ],
    ['italic', '[i]x[/i]', '<em>x</em>'],
    ['underline', '[u]x[/u]', '<u>x</u>'],
    ['strikethrough', '[s]x[/s]', '<s>x</s>'],
    [
      'important',
      '[important]x[/important]',
      '<span class="bbcode-important">x</span>'
    ],
    [
      'color name',
      '[color=blue]x[/color]',
      '<span style="color:blue">x</span>'
    ],
    [
      'color hex',
      '[color=#0000ff]x[/color]',
      '<span style="color:#0000ff">x</span>'
    ],
    [
      'colour alias',
      '[colour=blue]x[/colour]',
      '<span style="color:blue">x</span>'
    ],
    ['size 4', '[size=4]x[/size]', '<span style="font-size:1.35em">x</span>'],
    [
      'align center',
      '[align=center]x[/align]',
      '<div style="text-align:center">x</div>'
    ]
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(bb(input)).toBe(expected);
  });

  it('drops an invalid color value, keeping the text', () => {
    expect(bb('[color=red;x:url(y)]hi[/color]')).toBe('hi');
  });
  it('drops an out-of-range size, keeping the text', () => {
    expect(bb('[size=99]hi[/size]')).toBe('hi');
  });
  it('drops an invalid align, keeping the text', () => {
    expect(bb('[align=sideways]hi[/align]')).toBe('hi');
  });
});

describe('bbcode — headings', () => {
  it('renders == / === / ==== as h2 / h3 / h4', () => {
    expect(bb('==Two==')).toBe('<h2>Two</h2>');
    expect(bb('===Three===')).toBe('<h3>Three</h3>');
    expect(bb('====Four====')).toBe('<h4>Four</h4>');
  });
  it('parses inline BBCode inside a heading', () => {
    expect(bb('==[b]About[/b]==')).toBe('<h2><strong>About</strong></h2>');
  });
});

describe('bbcode — links and images', () => {
  it('labeled url', () => {
    expect(bb('[url=https://x.com/]Search[/url]')).toBe(
      '<a href="https://x.com/" rel="noopener noreferrer" target="_blank">Search</a>'
    );
  });
  it('bare url', () => {
    expect(bb('[url]https://x.com[/url]')).toBe(
      '<a href="https://x.com" rel="noopener noreferrer" target="_blank">https://x.com</a>'
    );
  });
  it('auto-links a naked url in flowing text', () => {
    expect(bb('see https://x.com ok')).toBe(
      'see <a href="https://x.com" rel="noopener noreferrer" target="_blank">https://x.com</a> ok'
    );
  });
  it('shortens on-site urls to their path and drops target', () => {
    expect(bb(`[url]${SITE}/wiki/5[/url]`)).toBe(
      '<a href="https://stellar.test/wiki/5">/wiki/5</a>'
    );
  });
  it('refuses a javascript: url, keeping the label', () => {
    expect(bb('[url=javascript:alert(1)]click[/url]')).toBe('click');
  });
  it('image with a valid extension', () => {
    expect(bb('[img]https://x.com/a.png[/img]')).toBe(
      '<img src="https://x.com/a.png" alt="" class="bbcode-img" />'
    );
  });
  it('image with a bad extension degrades to text', () => {
    expect(bb('[img]https://x.com/a.txt[/img]')).toBe('https://x.com/a.txt');
  });
});

describe('bbcode — blocks', () => {
  it('plain quote', () => {
    expect(bb('[quote]hi[/quote]')).toBe(
      '<blockquote class="bbcode-quote">hi</blockquote>'
    );
  });
  it('attributed quote', () => {
    expect(bb('[quote=John Doe]hi[/quote]')).toBe(
      '<blockquote class="bbcode-quote"><cite>John Doe wrote:</cite>hi</blockquote>'
    );
  });
  it('hide with default and custom summary', () => {
    expect(bb('[hide]s[/hide]')).toBe(
      '<details class="bbcode-hide"><summary>Hidden text</summary>s</details>'
    );
    expect(bb('[hide=Spoiler]s[/hide]')).toBe(
      '<details class="bbcode-hide"><summary>Spoiler</summary>s</details>'
    );
  });
  it('mature renders a collapsed disclosure (ungated in phase 1)', () => {
    expect(bb('[mature=nsfw]s[/mature]')).toBe(
      '<details class="bbcode-mature"><summary>nsfw</summary>s</details>'
    );
  });
  it('unordered and ordered loose lists', () => {
    expect(bb('[*] one\n[*] two\n')).toBe(
      '<ul class="bbcode-list"><li>one</li><li>two</li></ul>'
    );
    expect(bb('[#] one\n[#] two\n')).toBe(
      '<ol class="bbcode-list"><li>one</li><li>two</li></ol>'
    );
  });
  it('tolerates an explicit [list] wrapper', () => {
    expect(bb('[list][*] a[*] b[/list]')).toBe(
      '<ul class="bbcode-list"><li>a</li><li>b</li></ul>'
    );
  });
});

describe('bbcode — raw-content tags', () => {
  it('plain strips BBCode to literal text', () => {
    expect(bb('[plain][b]x[/b][/plain]')).toBe('[b]x[/b]');
  });
  it('code escapes and does not parse its body', () => {
    expect(bb('[code]a < [b]b[/b][/code]')).toBe(
      '<code class="bbcode-code">a &lt; [b]b[/b]</code>'
    );
  });
  it('pre preserves its body verbatim (escaped)', () => {
    expect(bb('[pre]  two  spaces[/pre]')).toBe(
      '<pre class="bbcode-pre">  two  spaces</pre>'
    );
  });
  it('tex renders LaTeX via server KaTeX (MathML + html)', () => {
    const out = bb('[tex]E = mc^2[/tex]');
    expect(out).toContain('<span class="katex">');
    expect(out).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML">');
    // The source round-trips verbatim in the MathML annotation.
    expect(out).toContain(
      '<annotation encoding="application/x-tex">E = mc^2</annotation>'
    );
  });
  it('tex does not parse its body as BBCode', () => {
    const out = bb('[tex][i]x[/i][/tex]');
    expect(out).not.toContain('<em>'); // [i] reached KaTeX as literal LaTeX
    expect(out).toContain('[i]x[/i]'); // preserved verbatim in the annotation
  });
});

describe('bbcode — tokenizer/stack semantics', () => {
  it('auto-closes inner tags when an outer close arrives', () => {
    expect(bb('[b][i][u]hi[/b]')).toBe('<strong><em><u>hi</u></em></strong>');
  });
  it('auto-closes unbalanced opens at end of input', () => {
    expect(bb('[b]hi')).toBe('<strong>hi</strong>');
  });
  it('renders a stray close as literal text', () => {
    expect(bb('hi[/b]')).toBe('hi[/b]');
  });
  it('renders an unknown tag as literal text', () => {
    expect(bb('[spoiler]x[/spoiler]')).toBe('[spoiler]x[/spoiler]');
  });
  it('[n] breaks a tag from triggering and is itself consumed', () => {
    expect(bb('[b[n]]Hello[/b]')).toBe('[b]Hello[/b]');
  });
});

describe('bbcode — security (escaping is the real guarantee)', () => {
  it('escapes raw html in text', () => {
    expect(bb('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });
  it('escapes html inside a formatting tag', () => {
    expect(bb('[b]<img src=x onerror=alert(1)>[/b]')).toBe(
      '<strong>&lt;img src=x onerror=alert(1)&gt;</strong>'
    );
  });
  it('neutralizes a style-breakout attempt in color', () => {
    expect(bb('[color=x"onmouseover="alert(1)]hi[/color]')).toBe('hi');
  });
});

describe('bbcode — DB-resolved tags', () => {
  const db = {
    user: {
      findMany: async () => [{ id: 42, username: 'WhatMan' }]
    },
    artist: {
      findMany: async () => [{ id: 7, name: 'Pink Floyd' }]
    },
    release: {
      findMany: async () => [{ id: 1179, communityId: 1512 }]
    },
    wikiPage: {
      findMany: async () => [{ id: 23, title: 'BB Code', slug: 'bb-code' }]
    },
    wikiAlias: {
      findMany: async () => [
        { alias: 'bbcode', page: { id: 23, title: 'BB Code' } }
      ]
    },
    forumPost: {
      findMany: async () => [
        { id: 900, forumTopicId: 12, forumTopic: { forumId: 3 } }
      ]
    }
  } as unknown as BBCtx['db'];
  const ctx: BBCtx = { db, siteUrl: SITE };

  it('resolves [user] by name to a profile link', async () => {
    expect(await renderBBCode('[user]WhatMan[/user]', ctx)).toBe(
      '<a href="/user/42">WhatMan</a>'
    );
  });
  it('resolves [artist] to an artist link', async () => {
    expect(await renderBBCode('[artist]Pink Floyd[/artist]', ctx)).toBe(
      '<a href="/artists/7">Pink Floyd</a>'
    );
  });
  it('resolves [release] by id, building the community-scoped url', async () => {
    expect(await renderBBCode('[release]1179[/release]', ctx)).toBe(
      '<a href="/communities/1512/releases/1179">1179</a>'
    );
  });
  it('resolves [[wiki]] via alias to a numeric page link', async () => {
    expect(await renderBBCode('[[bbcode]]', ctx)).toBe(
      '<a href="/wiki/23">BB Code</a>'
    );
  });
  it('links an attributed quote to its post', async () => {
    expect(await renderBBCode('[quote=Kai|900]hi[/quote]', ctx)).toBe(
      '<blockquote class="bbcode-quote"><cite><a href="/forums/3/topics/12#post-900">Kai wrote:</a></cite>hi</blockquote>'
    );
  });

  it('falls back to plain text for an unresolved reference', async () => {
    const emptyDb = {
      user: { findMany: async () => [] },
      artist: { findMany: async () => [] },
      release: { findMany: async () => [] },
      wikiPage: { findMany: async () => [] },
      wikiAlias: { findMany: async () => [] },
      forumPost: { findMany: async () => [] }
    } as unknown as BBCtx['db'];
    expect(
      await renderBBCode('[artist]Nobody[/artist]', {
        db: emptyDb,
        siteUrl: SITE
      })
    ).toBe('Nobody');
  });
});

describe('bbcode — rule links (pure, no DB)', () => {
  it('links a numeric sub-rule to its anchor', () => {
    expect(bb('[rule]2.3[/rule]')).toBe('<a href="/rules#2.3">2.3</a>');
  });
  it('links an h-prefixed group heading', () => {
    expect(bb('[rule]h2[/rule]')).toBe('<a href="/rules#2">h2</a>');
  });
  it('leaves a malformed rule code as plain text', () => {
    expect(bb('[rule]nope[/rule]')).toBe('nope');
  });
});

describe('bbcode — full render entry', () => {
  it('sanitizes and returns html, empty for empty input', async () => {
    const ctx: BBCtx = { db: {} as BBCtx['db'], siteUrl: SITE };
    expect(await renderBBCode('', ctx)).toBe('');
    expect(await renderBBCode('[b]hi[/b]', ctx)).toBe('<strong>hi</strong>');
  });
});
