import { z } from 'zod';

export const statsPeriodQuerySchema = z.object({
  period: z.enum(['Daily', 'Monthly', 'Yearly'])
});

export type StatsPeriodQuery = z.infer<typeof statsPeriodQuerySchema>;
