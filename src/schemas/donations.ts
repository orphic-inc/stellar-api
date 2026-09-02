import { z } from 'zod';

export const createDonationSchema = z.object({
  userId: z.number().int().positive(),
  amount: z.number().positive(),
  email: z.string().email(),
  donatedAt: z.string().datetime(),
  currency: z.string().default('USD'),
  source: z.string().default(''),
  reason: z.string().min(1, 'Reason is required')
});

export type CreateDonationInput = z.infer<typeof createDonationSchema>;
