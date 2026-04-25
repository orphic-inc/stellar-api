import { z } from 'zod';

export const createForumCategorySchema = z.object({
  name: z.string().min(1),
  sort: z.number().int().optional()
});

export const updateForumCategorySchema = z.object({
  name: z.string().min(1),
  sort: z.number().int().optional()
});

export type CreateForumCategoryInput = z.infer<
  typeof createForumCategorySchema
>;
export type UpdateForumCategoryInput = z.infer<
  typeof updateForumCategorySchema
>;
