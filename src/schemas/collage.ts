import { z } from 'zod';

export const createCollageSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(100),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(65535),
  categoryId: z.number().int().min(0).max(6).default(1),
  tags: z.array(z.string().min(1).max(50)).max(20).default([])
});

export const updateCollageSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  description: z.string().min(10).max(65535).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  isFeatured: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  maxEntries: z.number().int().min(0).optional(),
  maxEntriesPerUser: z.number().int().min(0).optional()
});

export const collageQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().max(200).optional(),
  categoryId: z.coerce.number().int().min(0).max(6).optional(),
  userId: z.coerce.number().int().positive().optional(),
  bookmarked: z.enum(['true', 'false']).optional(),
  orderBy: z
    .enum(['createdAt', 'updatedAt', 'name', 'numEntries', 'numSubscribers'])
    .optional(),
  order: z.enum(['asc', 'desc']).optional()
});

export const addEntrySchema = z.object({
  releaseId: z.number().int().positive()
});

export const reorderEntriesSchema = z.object({
  entries: z
    .array(
      z.object({
        id: z.number().int().positive(),
        sort: z.number().int().min(0)
      })
    )
    .min(1)
});

export type CreateCollageInput = z.infer<typeof createCollageSchema>;
export type UpdateCollageInput = z.infer<typeof updateCollageSchema>;
export type CollageQueryInput = z.infer<typeof collageQuerySchema>;
export type AddEntryInput = z.infer<typeof addEntrySchema>;
export type ReorderEntriesInput = z.infer<typeof reorderEntriesSchema>;
