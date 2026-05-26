import { z } from 'zod';

export const createStaffGroupSchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().int().min(0)
});

export const updateStaffGroupSchema = z
  .object({
    name: z.string().min(1).optional(),
    sortOrder: z.number().int().min(0).optional()
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field required'
  });

export type CreateStaffGroupInput = z.infer<typeof createStaffGroupSchema>;
export type UpdateStaffGroupInput = z.infer<typeof updateStaffGroupSchema>;
