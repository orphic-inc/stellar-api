/**
 * Store-time CSS sanitizer for user-authored stylesheets (ADR-0003, Arm 2).
 *
 * `AuthorStylesheet.source` is raw CSS that stellar-ui injects site-wide, so the
 * persisted artifact must already be safe (fail-closed) rather than trusting the
 * render path. This strips the constructs that turn a stylesheet into a fetch /
 * exfiltration vector:
 *
 *   - `@import` / `@charset` / `@namespace` at-rules — removed outright (a
 *     profile theme never legitimately needs to pull another sheet).
 *   - `url(...)` references (including `@font-face src`) — neutralized to `url()`
 *     unless they point at a `data:` URI or a same-origin relative path. An
 *     absolute/remote/`javascript:` URL would fire a request to an arbitrary
 *     host on every render.
 *
 * CSS lets these constructs hide behind **escape sequences** (`\40 import` for
 * `@import`, `url(\68 ttp://evil)` for `http://…`), which a raw-text regex would
 * miss while the browser's CSS parser still decodes them at render. So the source
 * is escape-decoded before matching, and the decode→strip pass repeats to a fixed
 * point (a decode can expose a fresh escape, e.g. `\5c` → `\`). Decoding yields
 * equivalent CSS for the cases themes use (color/content/spacing); the rare
 * escape-dependent identifier is an accepted trade.
 *
 * This pass is the ONLY control against exfiltration — there is no second half.
 * ADR-0003 paired it with a CSP that locked `img-src`/`font-src`/`connect-src`,
 * but the 2026-06-23 amendment reversed those axes to preserve theming freedom
 * and stellar-ui shipped them open (`img-src 'self' data: https: http:`). The
 * prod CSP is strict on execution (`script-src 'self'`) and constrains nothing
 * on resources, so a `url()` this pass misses reaches any host it names.
 *
 * [ADR-0031](../../docs/adr/0031-injected-css-threat-model.md) supersedes that
 * model and is the decided target, NOT YET IMPLEMENTED here: the allowlist
 * narrows to `/api/asset/<sha256>` and relative paths with `data:` removed, and
 * this function is replaced by a detector that rejects rather than rewrites —
 * because decoding the whole sheet in order to match is what persists mangled
 * bytes (#340). Until then the text above describes what this code actually does.
 *
 * Source is treated as plain CSS (ADR-0003 scopes server-side SCSS compilation of
 * untrusted input out; ADR-0024 makes `.css`-only the user contract).
 */

// `@import` / `@charset` / `@namespace` at-rules in any form (url(), quoted, bare).
const AT_RULE_STRIP = /@(?:import|charset|namespace)\b[^;]*;?/gi;

// `url( … )` in its three forms: double-quoted, single-quoted (quoted content
// may legitimately contain `)`), or a bare unquoted token (no whitespace/paren).
const URL_REF = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

// A CSS escape: a hex escape (1–6 hex digits, one optional trailing whitespace)
// or a single backslash-escaped character.
const CSS_ESCAPE = /\\([0-9a-fA-F]{1,6})[ \t\n\f\r]?|\\([^\n\f\r])/g;

/** Decode CSS escape sequences to their literal characters (NUL → U+FFFD per spec). */
const decodeCssEscapes = (value: string): string =>
  value.replace(CSS_ESCAPE, (_match, hex: string, lit: string) => {
    if (hex === undefined) return lit;
    const cp = parseInt(hex, 16);
    if (!cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
    return String.fromCodePoint(cp);
  });

/** A url() target is safe to keep if it is a data: URI or a same-origin relative path. */
const isSafeUrlTarget = (raw: string): boolean => {
  const target = decodeCssEscapes(raw).trim();
  if (target === '') return true;
  if (/^data:/i.test(target)) return true;
  // Reject protocol-relative (`//host`) and any explicit scheme (`http:`,
  // `javascript:`, …); everything else is a same-origin relative reference.
  if (target.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false;
  return true;
};

const stripOnce = (css: string): string =>
  decodeCssEscapes(css)
    .replace(AT_RULE_STRIP, '')
    .replace(URL_REF, (match, dq: string, sq: string, bare: string) =>
      isSafeUrlTarget(dq ?? sq ?? bare ?? '') ? match : 'url()'
    );

/**
 * Return a sanitized copy of a user-authored stylesheet's source, safe to
 * persist and inject. Never throws — like `sanitizeHtml`, it cleans rather than
 * rejects, so an honest author's save is not blocked by a stray reference.
 *
 * Repeats the decode→strip pass until it stabilizes; each pass is non-increasing
 * in length (decoding and stripping only shrink), so this terminates — the cap is
 * a defensive backstop against pathological input.
 */
export const sanitizeStylesheetSource = (source: string): string => {
  let out = source;
  for (let i = 0; i < 8; i++) {
    const next = stripOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
};
