import { z } from 'zod';

export const grantAccessSchema = z.object({
  idempotencyKey: z.string().max(128).optional()
});

export const reverseGrantSchema = z.object({
  reason: z.string().max(500).optional()
});

export const downloadGrantParamsSchema = z.object({
  grantId: z.coerce.number().int().positive()
});

export const contributionAccessParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

export type GrantAccessInput = z.infer<typeof grantAccessSchema>;
export type ReverseGrantInput = z.infer<typeof reverseGrantSchema>;
