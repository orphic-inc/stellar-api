import { z } from 'zod';

export const updateSettingsSchema = z
  .object({
    approvedDomains: z.array(z.string().min(1)).optional(),
    registrationStatus: z.enum(['open', 'invite', 'closed']).optional(),
    maxUsers: z.number().int().min(1).optional()
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field required'
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
