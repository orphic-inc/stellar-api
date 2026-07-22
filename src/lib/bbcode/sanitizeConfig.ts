import DOMPurify from 'isomorphic-dompurify';

// The authoritative allowlist for rendered BBCode (#398 Q15). The API is the
// source of truth; the UI's DOMPurify config must mirror this tag/attr set, and
// a UI test asserts the match. Wider than lib/sanitize.ts because BBCode emits
// headings, disclosures, aligned blocks, images, and validated inline styles.
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
    'img'
  ],
  // Values are already whitelist-validated by the emitter before they reach an
  // attribute; DOMPurify is the second net.
  ALLOWED_ATTR: ['href', 'class', 'style', 'rel', 'target', 'src', 'alt'],
  ALLOW_DATA_ATTR: false
};

export function sanitizeBBCode(html: string): string {
  return DOMPurify.sanitize(html, BBCODE_CONFIG);
}
