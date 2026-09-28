import { z } from 'zod';

/**
 * A remote image URL an image field may hold: http or https only (#737). A bare
 * `.url()` also admitted `ftp:`, `javascript:` and the rest, none of which the
 * importer can fetch, so they could never render (ADR-0051).
 */
export const httpImageUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'Image must be an http:// or https:// URL'
  });
