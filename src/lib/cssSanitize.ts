/**
 * Store-time CSS sanitizer for user-authored stylesheets (ADR-0003, Arm 2).
 *
 * `AuthorStylesheet.source` is raw CSS that stellar-ui injects site-wide, so the
 * persisted artifact must already be safe (fail-closed) rather than trusting the
 * render path. This strips the constructs that turn a stylesheet into a fetch /
 * exfiltration vector:
 *
 *   - `@import` / `@charset` at-rules — removed outright (a profile theme never
 *     legitimately needs to pull another sheet).
 *   - `url(...)` references (including `@font-face src`) — neutralized to `url()`
 *     unless they point at a `data:` URI or a same-origin relative path. An
 *     absolute/remote/`javascript:` URL would fire a request to an arbitrary
 *     host on every render.
 *
 * Source is treated as plain CSS (ADR-0003 scopes server-side SCSS compilation
 * of untrusted input out). This is the server half of a defense-in-depth
 * boundary; the inject-time CSP (`img-src`/`font-src`/`connect-src`) and the
 * protected chrome layer are the other halves, so an escape this regex pass
 * misses still cannot exfiltrate.
 */

// `@import ...;` and `@charset ...;` in any form (url(), quoted, bare).
const AT_RULE_STRIP = /@(?:import|charset)\b[^;]*;?/gi;

// `url( … )` in its three forms: double-quoted, single-quoted (quoted content
// may legitimately contain `)`), or a bare unquoted token (no whitespace/paren).
const URL_REF = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

/** A url() target is safe to keep if it is a data: URI or a same-origin relative path. */
const isSafeUrlTarget = (raw: string): boolean => {
  const target = raw.trim();
  if (target === '') return true;
  if (/^data:/i.test(target)) return true;
  // Reject protocol-relative (`//host`) and any explicit scheme (`http:`,
  // `javascript:`, …); everything else is a same-origin relative reference.
  if (target.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false;
  return true;
};

/**
 * Return a sanitized copy of a user-authored stylesheet's source, safe to
 * persist and inject. Never throws — like `sanitizeHtml`, it cleans rather than
 * rejects, so an honest author's save is not blocked by a stray reference.
 */
export const sanitizeStylesheetSource = (source: string): string =>
  source
    .replace(AT_RULE_STRIP, '')
    .replace(URL_REF, (match, dq: string, sq: string, bare: string) =>
      isSafeUrlTarget(dq ?? sq ?? bare ?? '') ? match : 'url()'
    );
