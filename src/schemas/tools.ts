import { z } from 'zod';

export const createRankSchema = z.object({
  name: z.string().min(1),
  level: z.number().int(),
  permissions: z.record(z.string(), z.boolean()).optional(),
  color: z.string().optional(),
  badge: z.string().optional(),
  personalCollageLimit: z.number().int().min(0).optional()
});

export const updateRankSchema = z
  .object({
    name: z.string().min(1).optional(),
    level: z.number().int().optional(),
    permissions: z.record(z.string(), z.boolean()).optional(),
    color: z.string().optional(),
    badge: z.string().optional(),
    personalCollageLimit: z.number().int().min(0).optional()
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field required'
  });

export type CreateRankInput = z.infer<typeof createRankSchema>;
export type UpdateRankInput = z.infer<typeof updateRankSchema>;
