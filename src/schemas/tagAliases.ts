import { z } from 'zod';

export const createTagAliasSchema = z.object({
  badTag: z.string().min(1).max(100).trim(),
  goodTag: z.string().min(1).max(100).trim()
});

export const updateTagAliasSchema = createTagAliasSchema;

export type CreateTagAliasInput = z.infer<typeof createTagAliasSchema>;
export type UpdateTagAliasInput = z.infer<typeof updateTagAliasSchema>;
