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

// A user-authored, named stylesheet saved for others to adopt (PRD-03 #4a).
// `source` is the CSS/SCSS the author wrote — not a URL like the admin
// Stylesheet's `cssUrl`.
export const authorStylesheetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  source: z.string().min(1, 'Stylesheet source is required')
});

export type AuthorStylesheetInput = z.infer<typeof authorStylesheetSchema>;
