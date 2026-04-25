import DOMPurify from 'isomorphic-dompurify';

// Allow common formatting tags but strip scripts and event handlers
const HTML_CONFIG = {
  ALLOWED_TAGS: [
    'b',
    'i',
    'u',
    'em',
    'strong',
    'a',
    'p',
    'br',
    'ul',
    'ol',
    'li',
    'blockquote',
    'code',
    'pre',
    'span'
  ],
  ALLOWED_ATTR: ['href', 'class'],
  ALLOW_DATA_ATTR: false
};

export const sanitizeHtml = (input: string): string =>
  DOMPurify.sanitize(input, HTML_CONFIG);

export const sanitizePlain = (input: string): string =>
  DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
