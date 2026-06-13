import { z } from 'zod';

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

// PRD-03 #118 — a user-authored stylesheet (one per author) saved for others to
// adopt. `source` is the raw CSS/SCSS; injection isolation is the UI injector's
// job (ADR-0003), so it is stored verbatim, not sanitized here.
export const authorStylesheetSchema = z.object({
  name: z.string().min(1).max(100),
  source: z.string().min(1).max(100_000)
});

export type AuthorStylesheetInput = z.infer<typeof authorStylesheetSchema>;
