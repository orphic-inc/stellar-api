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

// PRD-03 #118 — a user-authored stylesheet (many per author) saved for others to
// adopt. `source` is raw CSS in transit; the ingestion path sanitizes it at
// store-time via lib/cssSanitize.ts before persisting (ADR-0003 Arm 2), so the
// stored artifact is already safe. The UI injector's protected-chrome layer
// (ADR-0003 Arm 1) is the other half of the boundary.
export const authorStylesheetSchema = z.object({
  name: z.string().min(1).max(100),
  source: z.string().min(1).max(100_000)
});

export type AuthorStylesheetInput = z.infer<typeof authorStylesheetSchema>;
