import { z } from 'zod';
import { paginationBase } from '../lib/pagination';

export const promoteTagSchema = z.object({
  name: z.string().min(1).max(100).trim()
});

export const tagsQuerySchema = z.object({
  ...paginationBase,
  q: z.string().trim().min(1).max(100).optional()
});

export type PromoteTagInput = z.infer<typeof promoteTagSchema>;
export type TagsQuery = z.infer<typeof tagsQuerySchema>;
