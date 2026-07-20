/**
 * Store-time CSS validator for user-authored stylesheets (ADR-0031 §3/§5).
 *
 * `AuthorStylesheet.source` is raw CSS that stellar-ui injects site-wide, and
 * under ADR-0031 §1 the defended party is the **non-consenting viewer** — a
 * member who renders someone else's sheet without adopting it. So the persisted
 * artifact must already be safe rather than trusting the render path.
 *
 * This module **detects and rejects; it never rewrites.** The stored source is
 * byte-identical to what the author submitted. That is the whole design, and it
 * replaces a cleaning sanitizer that returned a modified copy:
 *
 *   - Detection has to decode CSS escape sequences, because a raw-text regex
 *     misses `\40 import` while the browser's parser still sees `@import`
 *     (bypass #152).
 *   - The old pass decoded the *entire sheet* and returned the decoded text, so
 *     a transformation that existed purely to make matching honest got
 *     persisted. That is what corrupted `.hover\:text-white` into
 *     `.hover:text-white` — a class selector turned into a pseudo-class that
 *     matches nothing (#340), across all 54 of `proton`'s Tailwind overrides.
 *
 * A detector that only answers yes/no may normalize as aggressively as
 * correctness demands at zero corruption risk, because it never writes. So the
 * decode stays and the rewrite goes.
 *
 * What is a violation (ADR-0031 §3):
 *
 *   - `@import` / `@charset` / `@namespace` — a theme never legitimately pulls
 *     another sheet.
 *   - `url()` naming any explicit scheme, or protocol-relative `//host`.
 *   - `url()` naming a `data:` URI — for **every** author including the reserved
 *     System user. `data:` was the content-smuggling vector, and the sanctioned
 *     home for theme imagery is the asset store (`/api/asset/<sha256>`).
 *
 * Everything else — ordinary same-origin relative references — is permitted, and
 * the allowlist is deliberately uniform and ownerless. System image capability
 * comes from asset-store write authorization, not from a trust tier here
 * (ADR-0031 §4): a member cannot reference a stored image because a member
 * cannot put one there. Keeping this a pure function of one string means one
 * policy to audit in a pass that has already shipped one bypass.
 *
 * **Accepted false positives.** Detection runs on decoded text and does not
 * tokenize, so escapes that decode into a banned construct are rejected wherever
 * they appear — including inside a string, where `content: "\40 import"` is
 * inert to a browser. Rejecting an honest save is the harder failure mode
 * (ADR-0031 §5), and this shape is accepted rather than unnoticed: the rule is
 * short and mechanical, and the error names the construct and its location so an
 * author can act on it. Escaped identifiers themselves are safe — `.hover\:x`
 * decodes to `hover:x`, which trips nothing.
 *
 * Source is treated as plain CSS (ADR-0024 §2 makes `.css`-only the user
 * contract; server-side SCSS compilation of untrusted input is out of scope).
 */

/** A CSS escape: a hex escape (1–6 hex digits, one optional trailing whitespace) or a backslash-escaped character. */
const CSS_ESCAPE = /\\([0-9a-fA-F]{1,6})[ \t\n\f\r]?|\\([^\n\f\r])/g;

/** Sheet-pulling at-rules, in any form. Matched on decoded text. */
const AT_RULE = /@(import|charset|namespace)\b/gi;

/** `url( … )` in its three forms: double-quoted, single-quoted (quoted content may contain `)`), or a bare unquoted token. */
const URL_REF = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

/** Longest offending snippet echoed back to the author; enough to locate, short enough to read. */
const CONSTRUCT_MAX = 80;

export type CssViolationRule =
  | 'at-rule'
  | 'url-scheme'
  | 'url-protocol-relative'
  | 'url-data';

export interface CssViolation {
  rule: CssViolationRule;
  /** The offending text as the author wrote it — original bytes, not the decoded form. */
  construct: string;
  /** 1-indexed position in the submitted source. */
  line: number;
  column: number;
  /** Actionable single-sentence explanation naming the rule. */
  message: string;
}

/**
 * One decode pass over `text`, carrying an index map back to the original source.
 *
 * `map[i]` is the offset in the *original* submitted source that decoded
 * character `i` came from, which is what lets a violation found in decoded space
 * be reported at a position the author can find in the bytes they wrote.
 */
const decodeStep = (
  text: string,
  map: number[]
): { text: string; map: number[] } => {
  let out = '';
  const outMap: number[] = [];
  let last = 0;

  CSS_ESCAPE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CSS_ESCAPE.exec(text)) !== null) {
    for (let i = last; i < m.index; i++) {
      out += text[i];
      outMap.push(map[i]);
    }

    const hex = m[1];
    const lit = m[2];
    let replacement: string;
    if (hex === undefined) {
      replacement = lit;
    } else {
      const cp = parseInt(hex, 16);
      // NUL and lone surrogates become U+FFFD, per the CSS escape rules.
      replacement =
        !cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
          ? '�'
          : String.fromCodePoint(cp);
    }

    // Step by UTF-16 unit, not code point: an astral replacement is two units
    // and the map must stay index-aligned with `out`.
    for (let k = 0; k < replacement.length; k++) {
      out += replacement[k];
      outMap.push(map[m.index]);
    }

    last = m.index + m[0].length;
  }

  for (let i = last; i < text.length; i++) {
    out += text[i];
    outMap.push(map[i]);
  }

  return { text: out, map: outMap };
};

/**
 * Decode to a fixed point, so a decode that exposes a fresh escape (`\5c` → `\`,
 * which can then form `\40 import`) cannot hide a construct from detection.
 *
 * This is deliberately more aggressive than a browser, which decodes once — a
 * browser would read `\5c 40 import` as the literal text `\40 import` and never
 * import anything. Over-detecting is the safe direction here and costs nothing
 * real: honest CSS does not contain doubly-escaped at-rules, while the escaped
 * identifiers that *are* common (Tailwind's `.hover\:x`) decode to something
 * that trips no rule. The iteration cap is a backstop against pathological
 * input; each pass is non-increasing in length, so it terminates on its own.
 */
const decodeToFixedPoint = (
  source: string
): { text: string; map: number[] } => {
  let state = {
    text: source,
    map: Array.from({ length: source.length }, (_, i) => i)
  };
  for (let i = 0; i < 8; i++) {
    const next = decodeStep(state.text, state.map);
    if (next.text === state.text) break;
    state = next;
  }
  return state;
};

/** Byte offset in the original source → 1-indexed line and column. */
const positionAt = (source: string, offset: number) => {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
};

/** Classify a `url()` target, or `null` when it is permitted. */
const classifyUrlTarget = (target: string): CssViolationRule | null => {
  const t = target.trim();
  if (t === '') return null;
  if (/^data:/i.test(t)) return 'url-data';
  if (t.startsWith('//')) return 'url-protocol-relative';
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return 'url-scheme';
  return null;
};

const MESSAGES: Record<CssViolationRule, (construct: string) => string> = {
  'at-rule': (c) =>
    `${c} is not allowed — a stylesheet may not pull in another sheet.`,
  'url-scheme': (c) =>
    `${c} names an external address — url() may only reference a same-origin relative path such as /api/asset/<hash>.`,
  'url-protocol-relative': (c) =>
    `${c} is a protocol-relative reference to another host — url() may only reference a same-origin relative path.`,
  'url-data': (c) =>
    `${c} is a data: URI — embed images through the asset store and reference them as /api/asset/<hash> instead.`
};

/**
 * Validate a user-authored stylesheet's source. Returns **every** violation, in
 * source order — not the first.
 *
 * Reporting all of them is deliberate (ADR-0032 §6): first-fail turns a sheet
 * with four bad `url()`s into four save attempts, and under a rejecting
 * validator the live risk is an honest author unable to act on the refusal.
 *
 * Never throws and never returns modified CSS. An empty array means the source
 * is safe to persist verbatim.
 */
export const cssValidate = (source: string): CssViolation[] => {
  const { text, map } = decodeToFixedPoint(source);
  const violations: (CssViolation & { offset: number })[] = [];

  const record = (
    rule: CssViolationRule,
    matchIndex: number,
    matchLength: number
  ) => {
    const start = map[matchIndex] ?? 0;
    const endIdx = matchIndex + matchLength - 1;
    const end = (map[endIdx] ?? source.length - 1) + 1;
    const construct = source.slice(start, Math.max(end, start + 1));
    const shown =
      construct.length > CONSTRUCT_MAX
        ? `${construct.slice(0, CONSTRUCT_MAX)}…`
        : construct;
    const { line, column } = positionAt(source, start);
    violations.push({
      rule,
      construct: shown,
      line,
      column,
      message: MESSAGES[rule](shown),
      offset: start
    });
  };

  AT_RULE.lastIndex = 0;
  let at: RegExpExecArray | null;
  while ((at = AT_RULE.exec(text)) !== null) {
    record('at-rule', at.index, at[0].length);
  }

  URL_REF.lastIndex = 0;
  let u: RegExpExecArray | null;
  while ((u = URL_REF.exec(text)) !== null) {
    const rule = classifyUrlTarget(u[1] ?? u[2] ?? u[3] ?? '');
    if (rule) record(rule, u.index, u[0].length);
  }

  return violations
    .sort((a, b) => a.offset - b.offset)
    .map(({ offset: _offset, ...v }) => v);
};

/** Render violations as the message list for a `{ errors: { source: [...] } }` envelope. */
export const formatCssViolations = (violations: CssViolation[]): string[] =>
  violations.map((v) => `Line ${v.line}:${v.column} — ${v.message}`);
