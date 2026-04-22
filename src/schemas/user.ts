import { z } from 'zod';

export const adminCreateUserSchema = z.object({
  username: z.string().min(1, 'Username is required').max(32),
  email: z.string().email('Please include a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  userRankId: z.number().int().positive().optional()
});

export const userSettingsSchema = z.object({
  siteAppearance: z.string().optional(),
  externalStylesheet: z.string().url().optional().or(z.literal('')),
  styledTooltips: z.boolean().optional(),
  paranoia: z.boolean().optional()
});

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type UserSettingsInput = z.infer<typeof userSettingsSchema>;
