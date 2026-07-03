import { z } from 'zod';
import { externalStylesheetUrl } from './stylesheet';

export const adminCreateUserSchema = z.object({
  username: z.string().min(1, 'Username is required').max(32),
  email: z.string().email('Please include a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  userRankId: z.number().int().positive().optional()
});

export const userSettingsSchema = z.object({
  siteAppearance: z.string().optional(),
  externalStylesheet: externalStylesheetUrl,
  styledTooltips: z.boolean().optional(),
  paranoia: z.coerce.number().int().min(0).max(3).optional(),
  avatar: z.string().optional(),
  notificationMethod: z
    .enum(['Disabled', 'Popup', 'Traditional', 'Push', 'Combined'])
    .optional(),
  showEmail: z.boolean().optional(),
  showLastSeen: z.boolean().optional(),
  showContributedStats: z.boolean().optional(),
  showConsumedStats: z.boolean().optional(),
  showRatioStats: z.boolean().optional()
});

export const warnUserSchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
  expiresAt: z.string().datetime().optional()
});

export const moderationNoteSchema = z.object({
  body: z.string().min(1, 'Body is required')
});

export const setRankSchema = z.object({
  userRankId: z.number().int().positive(),
  secondaryRankIds: z.array(z.number().int().positive()).default([])
});

export const rankLockSchema = z.object({
  rankLocked: z.boolean()
});

export const donorRankSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  minDonation: z.number().positive(),
  expiresAfterDays: z.number().int().positive().optional(),
  perks: z.record(z.string(), z.boolean()).optional(),
  color: z.string().optional(),
  badge: z.string().optional()
});

export const grantDonorSchema = z.object({
  donorRankId: z.number().int().positive(),
  expiresAt: z.string().optional()
});

// IRC Nick Verification relay (ADR-0015) — korin POSTs the authenticated IRC
// sender nick + the Verification Code it received over a private query.
export const ircNickVerifySchema = z.object({
  nick: z.string().min(1).max(30),
  code: z.string().min(1).max(16)
});

export const pmDraftSchema = z.object({
  toUserId: z.number().int().positive().optional(),
  toUsername: z.string().optional(),
  subject: z.string().max(255),
  body: z.string()
});

export const massPmSchema = z.object({
  subject: z.string().max(255),
  body: z.string(),
  targetRankId: z.number().int().positive().optional()
});

export const siteHistorySchema = z.object({
  title: z.string().min(1, 'Title is required'),
  body: z.string().min(1, 'Body is required')
});

export const dncSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  comment: z.string().optional().default('')
});

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type UserSettingsInput = z.infer<typeof userSettingsSchema>;
export type WarnUserInput = z.infer<typeof warnUserSchema>;
export type ModerationNoteInput = z.infer<typeof moderationNoteSchema>;
export type SetRankInput = z.infer<typeof setRankSchema>;
export type RankLockInput = z.infer<typeof rankLockSchema>;
export type DonorRankInput = z.infer<typeof donorRankSchema>;
export type GrantDonorInput = z.infer<typeof grantDonorSchema>;
export type IrcNickVerifyInput = z.infer<typeof ircNickVerifySchema>;
export type PmDraftInput = z.infer<typeof pmDraftSchema>;
export type MassPmInput = z.infer<typeof massPmSchema>;
export type SiteHistoryInput = z.infer<typeof siteHistorySchema>;
export type DncInput = z.infer<typeof dncSchema>;
