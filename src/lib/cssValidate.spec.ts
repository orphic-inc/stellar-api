/**
 * Boundary spec for the store-time CSS validator (ADR-0031 §3/§5).
 *
 * Ported from `cssSanitize.spec.ts` with the posture inverted: every case that
 * asserted "the construct was stripped and the sheet still saved" now asserts
 * "the save is refused and names why". One case flips outright — `data:` URIs
 * were explicitly preserved and are now a violation for every author, System
 * included (ADR-0031 §3), which #351 called out as the inversion to make
 * deliberately rather than carry across.
 *
 * The accept half matters as much as the reject half here. Under a rejecting
 * validator the live risk is a false positive blocking an honest save, so the
 * realistic-shape cases below (escaped Tailwind identifiers, @media/@supports/
 * @keyframes, @font-face, asset refs) are load-bearing, not padding.
 */
import { cssValidate, formatCssViolations } from './cssValidate';

/** Rules reported for a source, in order. */
const rules = (css: string) => cssValidate(css).map((v) => v.rule);

describe('cssValidate — rejects', () => {
  it('rejects @import in url and quoted forms', () => {
    expect(
      rules('@import url("https://evil.test/x.css");\nbody{color:red}')
    ).toContain('at-rule');
    expect(
      rules("@import 'https://evil.test/x.css';\nbody{color:red}")
    ).toContain('at-rule');
    // Even a same-origin import is refused — a theme never pulls another sheet.
    expect(rules('@import url(x.css);\nbody{color:red}')).toEqual(['at-rule']);
  });

  it('rejects @charset and @namespace', () => {
    expect(rules('@charset "UTF-8";\nbody{}')).toEqual(['at-rule']);
    expect(rules('@namespace svg url(http://www.w3.org/2000/svg);')).toContain(
      'at-rule'
    );
  });

  it('rejects remote url() references — the exfiltration vector', () => {
    expect(rules('body{background:url(https://evil.test/p.gif)}')).toEqual([
      'url-scheme'
    ]);
    expect(rules('body{background:url("http://evil.test/p.gif")}')).toEqual([
      'url-scheme'
    ]);
    expect(rules('a{background:url("javascript:alert(1)")}')).toEqual([
      'url-scheme'
    ]);
    expect(rules('a{cursor:url(//evil.test/c)}')).toEqual([
      'url-protocol-relative'
    ]);
  });

  it('rejects a remote @font-face src', () => {
    expect(
      rules('@font-face{font-family:x;src:url(https://evil.test/f.woff2)}')
    ).toEqual(['url-scheme']);
  });

  // ─── The ADR-0031 §3 inversion ──────────────────────────────────────────────
  it('rejects data: URIs, which the cleaning sanitizer preserved', () => {
    expect(rules('body{background:url(data:image/png;base64,AAAA)}')).toEqual([
      'url-data'
    ]);
    // No author tier is exempt — the System user is held to the same rule.
    expect(rules("body{background:url('data:text/html,<b>x')}")).toEqual([
      'url-data'
    ]);
  });

  // ─── CSS-escape bypass (#152) ───────────────────────────────────────────────
  it('sees @import hidden behind an escaped @ (\\40 import)', () => {
    expect(
      rules('\\40 import url("https://evil.test/x.css");\nbody{color:red}')
    ).toContain('at-rule');
  });

  it('sees @import with an escaped keyword letter (@\\69mport)', () => {
    expect(
      rules('@\\69mport url("https://evil.test/x.css");\nbody{}')
    ).toContain('at-rule');
  });

  it('sees a url() whose scheme is escaped (\\68 ttp:)', () => {
    expect(rules('a{background:url(\\68ttp://evil.test/p.gif)}')).toEqual([
      'url-scheme'
    ]);
  });

  it('sees an escape that decodes into another escape', () => {
    // `\5c` → `\`, so this becomes `\40import …` then `@import …` across passes.
    expect(rules('\\5c 40import url(http://evil.test/x)')).toContain('at-rule');
  });
});

describe('cssValidate — accepts', () => {
  it('accepts clean CSS', () => {
    expect(
      cssValidate('.theme{color:#abc;margin:0}\n#nav{display:flex}')
    ).toEqual([]);
  });

  it('accepts same-origin relative references and asset-store URLs', () => {
    expect(cssValidate('body{background:url(/assets/bg.png)}')).toEqual([]);
    expect(cssValidate('body{background:url("./img/x.png")}')).toEqual([]);
    expect(
      cssValidate(`body{background:url(/api/asset/${'a'.repeat(64)})}`)
    ).toEqual([]);
    // An empty url() is inert, not a violation.
    expect(cssValidate('body{background:url()}')).toEqual([]);
  });

  it('accepts escaped Tailwind utility identifiers — the #340 corruption case', () => {
    // These decode to `hover:text-white`, which trips no rule. The cleaning
    // sanitizer rewrote the stored bytes here and broke the selector; a
    // validator that never writes cannot.
    const css =
      'header .hover\\:text-white:hover{color:#111}\n.md\\:flex{display:flex}';
    expect(cssValidate(css)).toEqual([]);
  });

  it('accepts the at-rules a real theme needs', () => {
    expect(
      cssValidate(
        '@media (min-width:40rem){body{color:red}}' +
          '@supports (display:grid){body{display:grid}}' +
          '@keyframes spin{to{transform:rotate(360deg)}}'
      )
    ).toEqual([]);
  });

  it('accepts a @font-face whose src is a stored asset', () => {
    expect(
      cssValidate(
        `@font-face{font-family:x;src:url(/api/asset/${'b'.repeat(
          64
        )}) format("woff2")}`
      )
    ).toEqual([]);
  });
});

describe('cssValidate — reporting', () => {
  it('reports every violation, not just the first', () => {
    const css = [
      'body{background:url(https://a.test/1.gif)}',
      'div{background:url(https://b.test/2.gif)}',
      'p{background:url(data:image/png;base64,AA)}'
    ].join('\n');
    expect(rules(css)).toEqual(['url-scheme', 'url-scheme', 'url-data']);
  });

  it('reports violations in source order with 1-indexed positions', () => {
    const css = 'body{color:red}\n\ndiv{background:url(https://evil.test/x)}';
    const [v] = cssValidate(css);
    expect(v.line).toBe(3);
    expect(v.column).toBe(16);
  });

  it('names the offending construct as the author wrote it, not decoded', () => {
    const [v] = cssValidate('a{background:url(\\68ttp://evil.test/p.gif)}');
    expect(v.construct).toContain('\\68ttp');
    expect(v.message).toContain('same-origin relative path');
  });

  it('formats violations for the { errors: { source } } envelope', () => {
    const msgs = formatCssViolations(
      cssValidate('body{background:url(data:image/png;base64,AA)}')
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(/^Line 1:\d+ — /);
    expect(msgs[0]).toContain('/api/asset/<hash>');
  });

  it('never returns modified CSS — the input is untouched', () => {
    const hostile = '@import url(https://evil.test/x.css);body{color:red}';
    const before = hostile;
    cssValidate(hostile);
    expect(hostile).toBe(before);
  });
});
