import { z } from 'zod';

export const normalizeRulesSlug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

export const createRulesPageSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z
    .string()
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens')
    .optional(),
  body: z.string().min(1),
  isMain: z.boolean().optional().default(false),
  sortOrder: z.number().int().min(0).optional().default(0)
});

export const updateRulesPageSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).optional(),
  isMain: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional()
});

export const rulesPageParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const rulesSlugParamsSchema = z.object({
  slug: z.string().min(1).max(100)
});

export type CreateRulesPageInput = z.infer<typeof createRulesPageSchema>;
export type UpdateRulesPageInput = z.infer<typeof updateRulesPageSchema>;
