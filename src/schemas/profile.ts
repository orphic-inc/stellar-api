import { z } from 'zod';

export const profileUpdateSchema = z.object({
  avatar: z.string().url().optional().or(z.literal('')),
  avatarMouseoverText: z.string().max(256).optional(),
  profileTitle: z.string().max(128).optional(),
  profileInfo: z.string().max(10000).optional(),
  siteAppearance: z.string().optional(),
  externalStylesheet: z.string().optional(),
  styledTooltips: z.boolean().optional(),
  paranoia: z.coerce.number().int().min(0).max(3).optional(),
  notificationMethod: z
    .enum(['Disabled', 'Popup', 'Traditional', 'Push', 'Combined'])
    .optional(),
  showEmail: z.boolean().optional(),
  showLastSeen: z.boolean().optional(),
  showContributedStats: z.boolean().optional(),
  showConsumedStats: z.boolean().optional(),
  showRatioStats: z.boolean().optional()
});

export const inviteSchema = z.object({
  email: z.string().email('Valid email is required'),
  reason: z.string().max(1000).optional()
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
