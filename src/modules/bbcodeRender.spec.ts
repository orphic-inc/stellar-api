/**
 * The shared render-at-read seam every prose surface uses in Phase 2 (#402):
 * `renderSiteBBCode` wires the app singletons into the decoupled BBCode renderer,
 * and `withBodyHtml` attaches the additive `bodyHtml` next to a row's raw `body`.
 */

const prismaMock = {};

jest.mock('../lib/prisma', () => ({ prisma: prismaMock }));

// The site sanitizer eagerly loads isomorphic-dompurify (jsdom ESM), which jest
// can't parse. Stub it to identity — the emitter's escaping is the real defense
// and is asserted directly in bbcode.spec.ts.
jest.mock('../lib/bbcode/sanitizeConfig', () => ({
  sanitizeBBCode: (v: string) => v
}));

jest.mock('./config', () => ({
  email: { siteUrl: 'https://example.test' }
}));

import { renderSiteBBCode, withBodyHtml } from './bbcodeRender';

describe('renderSiteBBCode', () => {
  it('transcribes BBCode to HTML at read time', async () => {
    expect(await renderSiteBBCode('[b]hello[/b]')).toBe(
      '<strong>hello</strong>'
    );
  });

  it('returns empty string for null/empty input (no store-time value)', async () => {
    expect(await renderSiteBBCode(null)).toBe('');
    expect(await renderSiteBBCode('')).toBe('');
    expect(await renderSiteBBCode(undefined)).toBe('');
  });
});

describe('withBodyHtml', () => {
  it('attaches a rendered bodyHtml while leaving the raw body unchanged', async () => {
    const row = { id: 7, body: '[i]note[/i]' };
    const result = await withBodyHtml(row);
    expect(result.body).toBe('[i]note[/i]');
    expect(result.bodyHtml).toBe('<em>note</em>');
    expect(result.id).toBe(7);
  });
});
