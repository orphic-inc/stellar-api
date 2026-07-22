import { RawTag, Token, WrappingRawTag } from './types';

// A clean tag: [tag], [tag=arg], or [/tag]. The arg deliberately forbids brackets
// (`[^\]\[]`) so an embedded `[n]` (e.g. `[b[n]]`) fails to match here and falls
// through to be handled as the no-trigger marker below.
const TAG_RE = /^\[(\/?)([a-zA-Z0-9*#]+)(?:=([^\][]*))?\]/;
// A heading, only at line start: ==h2==, ===h3===, ====h4====. Backreference \1
// requires the same run of `=` on both sides.
const HEADING_RE = /^(={2,4})([^\n]+?)\1[ \t]*(?=\n|$)/;
const RAW_OPEN_RE = /^\[(plain|code|pre|tex)\]/i;
// [[wiki-ref]] — a wiki link; double brackets, no inner BBCode.
const WIKI_RE = /^\[\[([^\]\n]+)\]\]/;

function normalizeTag(tag: string): string {
  const t = tag.toLowerCase();
  return t === 'colour' ? 'color' : t; // spec: [colour] is an alias for [color]
}

export function tokenize(raw: string): Token[] {
  const tokens: Token[] = [];
  const len = raw.length;
  let i = 0;
  let text = '';

  const flush = () => {
    if (text) {
      tokens.push({ type: 'text', value: text });
      text = '';
    }
  };

  while (i < len) {
    const atLineStart = i === 0 || raw[i - 1] === '\n';

    // Headings — line-start only. The inner is re-tokenized so inline BBCode
    // inside a heading (e.g. `==[b]About[/b]==`) still works.
    if (atLineStart && raw[i] === '=') {
      const m = HEADING_RE.exec(raw.slice(i));
      if (m) {
        flush();
        const level = m[1].length; // 2, 3, or 4
        tokens.push({ type: 'open', tag: `h${level}` });
        for (const t of tokenize(m[2])) tokens.push(t);
        tokens.push({ type: 'close', tag: `h${level}` });
        i += m[0].length;
        continue;
      }
    }

    if (raw[i] === '[') {
      const rest = raw.slice(i);

      const wiki = WIKI_RE.exec(rest);
      if (wiki) {
        flush();
        tokens.push({ type: 'open', tag: 'wikilink', arg: wiki[1] });
        tokens.push({ type: 'close', tag: 'wikilink' });
        i += wiki[0].length;
        continue;
      }

      // Raw-content open tag: consume through the matching close; body stays literal.
      const rawOpen = RAW_OPEN_RE.exec(rest);
      if (rawOpen) {
        const tag = rawOpen[1].toLowerCase() as RawTag;
        const close = `[/${tag}]`;
        const closeIdx = raw
          .toLowerCase()
          .indexOf(close, i + rawOpen[0].length);
        if (closeIdx !== -1) {
          const content = raw.slice(i + rawOpen[0].length, closeIdx);
          flush();
          if (tag === 'plain') tokens.push({ type: 'text', value: content });
          else
            tokens.push({ type: 'raw', tag: tag as WrappingRawTag, content });
          i = closeIdx + close.length;
          continue;
        }
        // Unbalanced raw open: fall through and treat '[' as a literal below.
      }

      const m = TAG_RE.exec(rest);
      if (m) {
        const slash = m[1];
        const tag = normalizeTag(m[2]);
        const arg = m[3];

        if (!slash && tag === 'n') {
          // No-trigger marker: consumed, emits nothing. TAG_RE already refused to
          // match an outer tag wrapping this (its arg forbids brackets), so a
          // construct like `[b[n]]` has left `[b]` as literal text and this only
          // swallows the marker.
          i += m[0].length;
          continue;
        }
        if (!slash && tag === '*') {
          flush();
          tokens.push({ type: 'item', ordered: false });
          i += m[0].length;
          continue;
        }
        if (!slash && tag === '#') {
          flush();
          tokens.push({ type: 'item', ordered: true });
          i += m[0].length;
          continue;
        }

        flush();
        if (slash) tokens.push({ type: 'close', tag });
        else tokens.push({ type: 'open', tag, arg });
        i += m[0].length;
        continue;
      }

      // Not a recognizable tag: a literal '['.
      text += '[';
      i += 1;
      continue;
    }

    text += raw[i];
    i += 1;
  }

  flush();
  return tokens;
}
