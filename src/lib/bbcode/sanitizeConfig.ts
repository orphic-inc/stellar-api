import DOMPurify from 'isomorphic-dompurify';

// KaTeX (#403) emits MathML for accessibility, HTML spans for visual layout, and
// a little inline SVG for radicals/delimiters/accents. These are the element and
// attribute names it uses; the MathML/SVG tag lists are finite and enumerated
// rather than pulled from a profile so the base BBCode allowlist stays narrow
// (#398 Q15) — only the KaTeX surface is added, nothing else from full MathML/SVG.
const KATEX_MATHML_TAGS = [
  'math',
  'semantics',
  'annotation',
  'mrow',
  'mi',
  'mo',
  'mn',
  'ms',
  'mtext',
  'mspace',
  'msup',
  'msub',
  'msubsup',
  'mfrac',
  'msqrt',
  'mroot',
  'mover',
  'munder',
  'munderover',
  'mmultiscripts',
  'mprescripts',
  'none',
  'mtable',
  'mtr',
  'mtd',
  'mpadded',
  'mphantom',
  'menclose',
  'mstyle',
  'merror'
];
const KATEX_SVG_TAGS = ['svg', 'path', 'line', 'rect', 'g'];
// Presentational MathML + SVG attributes KaTeX emits. All layout-only; DOMPurify
// still strips event handlers and validates URI attributes regardless.
const KATEX_ATTR = [
  'xmlns',
  'encoding',
  'aria-hidden',
  'title',
  'mathvariant',
  'mathcolor',
  'displaystyle',
  'scriptlevel',
  'stretchy',
  'fence',
  'accent',
  'accentunder',
  'notation',
  'linethickness',
  'columnalign',
  'columnspacing',
  'rowspacing',
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'd',
  'fill',
  'stroke',
  'stroke-width',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2'
];

// The authoritative allowlist for rendered BBCode (#398 Q15). The API is the
// source of truth; the UI's DOMPurify config must mirror this tag/attr set, and
// a UI test asserts the match. Wider than lib/sanitize.ts because BBCode emits
// headings, disclosures, aligned blocks, images, validated inline styles, and
// server-rendered KaTeX math (#403).
const BBCODE_CONFIG = {
  ALLOWED_TAGS: [
    'strong',
    'em',
    'u',
    's',
    'span',
    'div',
    'a',
    'br',
    'blockquote',
    'cite',
    'details',
    'summary',
    'pre',
    'code',
    'ul',
    'ol',
    'li',
    'h2',
    'h3',
    'h4',
    'img',
    ...KATEX_MATHML_TAGS,
    ...KATEX_SVG_TAGS
  ],
  // Values are already whitelist-validated by the emitter before they reach an
  // attribute; DOMPurify is the second net.
  ALLOWED_ATTR: [
    'href',
    'class',
    'style',
    'rel',
    'target',
    'src',
    'alt',
    ...KATEX_ATTR
  ],
  ALLOW_DATA_ATTR: false
};

export function sanitizeBBCode(html: string): string {
  return DOMPurify.sanitize(html, BBCODE_CONFIG);
}
