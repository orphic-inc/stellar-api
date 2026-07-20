import { z } from 'zod';

// The Personal source (ADR-0024 §3): a self-hosted external stylesheet URL.
// `https:` only, end to end — `.url()` alone admits `ftp:`/`javascript:`, valid
// URLs the UI's https-gated injector (and the prod CSP `style-src … https:`) will
// never render, so a save that stored one would silently no-op — a contract lie.
// Empty string is the explicit "clear this slot" value, preserved from before.
export const externalStylesheetUrl = z
  .string()
  .url()
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'External stylesheet must be an https:// URL')
  .optional()
  .or(z.literal(''));

export const stylesheetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  cssUrl: z.string().min(1, 'CSS URL is required'),
  isDefault: z.boolean().optional().default(false)
});

// Defined independently so no defaults carry through — empty body is a validation error.
export const stylesheetUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    cssUrl: z.string().min(1, 'CSS URL is required').optional(),
    isDefault: z.boolean().optional()
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    'At least one field must be provided'
  );

export type StylesheetInput = z.infer<typeof stylesheetSchema>;
export type StylesheetUpdateInput = z.infer<typeof stylesheetUpdateSchema>;

// PRD-03 #118 — a user-authored stylesheet (many per author) saved for others to
// adopt. `source` is plain CSS, validated at store-time by lib/cssValidate.ts
// and persisted **verbatim**: the boundary rejects an unsafe sheet rather than
// cleaning it (ADR-0031 §5, superseding ADR-0003), so the stored bytes are the
// author's bytes. That pass is the sole exfiltration control — stellar-ui's CSP
// is open on `img-src`, so it is a partial backstop and not the boundary's other
// half. Never SCSS (ADR-0024 §2); delivered to the browser as text/css via the
// /css route, not as JSON to inject.
export const authorStylesheetSchema = z.object({
  name: z.string().min(1).max(100),
  source: z.string().min(1).max(100_000)
});

export type AuthorStylesheetInput = z.infer<typeof authorStylesheetSchema>;
