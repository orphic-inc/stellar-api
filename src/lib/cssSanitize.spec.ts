import { sanitizeStylesheetSource } from './cssSanitize';

describe('sanitizeStylesheetSource (ADR-0003 store-time CSS sanitizer)', () => {
  it('strips @import at-rules (url and quoted forms)', () => {
    expect(
      sanitizeStylesheetSource(
        '@import url("https://evil.test/x.css");\nbody{color:red}'
      )
    ).not.toMatch(/@import/i);
    expect(
      sanitizeStylesheetSource(
        "@import 'https://evil.test/x.css';\nbody{color:red}"
      )
    ).not.toMatch(/@import/i);
    // the legitimate rule survives
    expect(
      sanitizeStylesheetSource('@import url(x.css);\nbody{color:red}')
    ).toMatch(/body\{color:red\}/);
  });

  it('strips @charset at-rules', () => {
    expect(sanitizeStylesheetSource('@charset "UTF-8";\nbody{}')).not.toMatch(
      /@charset/i
    );
  });

  it('neutralizes remote url() references (the exfiltration vector)', () => {
    expect(
      sanitizeStylesheetSource('body{background:url(https://evil.test/p.gif)}')
    ).toBe('body{background:url()}');
    expect(
      sanitizeStylesheetSource('body{background:url("http://evil.test/p.gif")}')
    ).toBe('body{background:url()}');
    // protocol-relative and javascript: are remote too
    expect(sanitizeStylesheetSource('a{cursor:url(//evil.test/c)}')).toBe(
      'a{cursor:url()}'
    );
    expect(
      sanitizeStylesheetSource('a{background:url("javascript:alert(1)")}')
    ).toBe('a{background:url()}');
  });

  it('keeps data: URIs and same-origin relative references', () => {
    const dataUri = 'body{background:url(data:image/png;base64,AAAA)}';
    expect(sanitizeStylesheetSource(dataUri)).toBe(dataUri);
    const relative = 'body{background:url(/assets/bg.png)}';
    expect(sanitizeStylesheetSource(relative)).toBe(relative);
    const relativeDot = 'body{background:url("./img/x.png")}';
    expect(sanitizeStylesheetSource(relativeDot)).toBe(relativeDot);
  });

  it('neutralizes a remote @font-face src', () => {
    const out = sanitizeStylesheetSource(
      '@font-face{font-family:x;src:url(https://evil.test/f.woff2)}'
    );
    expect(out).toContain('src:url()');
    expect(out).not.toContain('evil.test');
  });

  it('leaves clean CSS untouched', () => {
    const clean = '.theme{color:#abc;margin:0}\n#nav{display:flex}';
    expect(sanitizeStylesheetSource(clean)).toBe(clean);
  });

  // ─── CSS-escape bypass (#152) ───────────────────────────────────────────────
  it('strips @import hidden behind an escaped @ (\\40 import)', () => {
    const out = sanitizeStylesheetSource(
      '\\40 import url("https://evil.test/x.css");\nbody{color:red}'
    );
    expect(out).not.toMatch(/@import/i);
    expect(out).not.toContain('evil.test');
    expect(out).toMatch(/body\{color:red\}/);
  });

  it('strips @import with an escaped keyword letter (@\\69mport)', () => {
    const out = sanitizeStylesheetSource(
      '@\\69mport url("https://evil.test/x.css");\nbody{}'
    );
    expect(out).not.toMatch(/@import/i);
    expect(out).not.toContain('evil.test');
  });

  it('neutralizes a url() whose scheme is escaped (\\68 ttp:)', () => {
    const out = sanitizeStylesheetSource(
      'a{background:url(\\68ttp://evil.test/p.gif)}'
    );
    expect(out).not.toContain('evil.test');
  });

  it('reaches a fixed point when an escape decodes into another escape', () => {
    // `\5c` → `\`, so this becomes `\40import …` then `@import …` across passes.
    const out = sanitizeStylesheetSource(
      '\\5c 40import url(http://evil.test/x)'
    );
    expect(out).not.toMatch(/@import/i);
    expect(out).not.toContain('evil.test');
  });
});
