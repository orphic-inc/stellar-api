import { z } from 'zod';

export const normalizeSlug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

export const createWikiPageSchema = z.object({
  title: z.string().min(3).max(100),
  body: z.string().min(1),
  slug: z
    .string()
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens')
    .optional(),
  minReadLevel: z.number().int().min(0).max(1000).optional().default(0),
  minEditLevel: z.number().int().min(0).max(1000).optional().default(0)
});

export const updateWikiPageSchema = z.object({
  title: z.string().min(3).max(100).optional(),
  body: z.string().min(1).optional(),
  minReadLevel: z.number().int().min(0).max(1000).optional(),
  minEditLevel: z.number().int().min(0).max(1000).optional()
});

export const wikiPageParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const wikiRevisionParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  rev: z.coerce.number().int().positive()
});

export const addAliasSchema = z.object({
  alias: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Alias must be lowercase alphanumeric with hyphens')
});

export const wikiSearchQuerySchema = z.object({
  q: z.string().optional(),
  type: z.enum(['title', 'body', 'all']).optional().default('all'),
  order: z.enum(['title', 'created', 'edited']).optional().default('title'),
  way: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25)
});

export const wikiCompareQuerySchema = z.object({
  old: z.coerce.number().int().positive(),
  new: z.coerce.number().int().positive()
});

export type CreateWikiPageInput = z.infer<typeof createWikiPageSchema>;
export type UpdateWikiPageInput = z.infer<typeof updateWikiPageSchema>;
export type AddAliasInput = z.infer<typeof addAliasSchema>;
export type WikiSearchQuery = z.infer<typeof wikiSearchQuerySchema>;
export type WikiCompareQuery = z.infer<typeof wikiCompareQuerySchema>;
