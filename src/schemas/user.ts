import { z } from 'zod';
import { externalStylesheetUrl } from './stylesheet';
import { avatarUrl } from './profile';
import { STAFF_INVITE_COUNT_MAX } from '../modules/inviteControls';

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
  // The second avatar write path, and until #396 the laxer one: this schema had
  // no URL validation at all, so `PUT /api/users/settings` accepted anything a
  // string could hold while `PUT /api/profile/me` at least required a URL. #361
  // named only the profile schema; a boundary on one of two doors is not one.
  // Note the two write DIFFERENT columns — this one `User.avatar`, the profile
  // one `Profile.avatar` — which is pre-existing and left alone here.
  avatar: avatarUrl,
  notificationMethod: z
    .enum(['Disabled', 'Popup', 'Traditional', 'Push', 'Combined'])
    .optional(),
  showEmail: z.boolean().optional(),
  showLastSeen: z.boolean().optional(),
  showContributedStats: z.boolean().optional(),
  showConsumedStats: z.boolean().optional(),
  showRatioStats: z.boolean().optional(),
  showMatureContent: z.boolean().optional()
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

// Staff invite controls (#636). `reason` is staff-only and goes to the audit
// row; `message`, when sent, is PMed to the member.
const staffReason = z.string().trim().min(1, 'Reason is required');
const memberMessage = z.string().trim().min(1).optional();

export const canInviteSchema = z.object({
  canInvite: z.boolean(),
  reason: staffReason,
  message: memberMessage
});

const inviteCount = z.number().int().min(0).max(STAFF_INVITE_COUNT_MAX);

export const inviteCountSchema = z.object({
  inviteCount,
  // Required: the write is a compare-and-set against the count the caller saw.
  expectedInviteCount: z.number().int().min(0),
  reason: staffReason,
  message: memberMessage
});

export const cancelInviteSchema = z.object({
  reason: staffReason,
  message: memberMessage
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

export const staffBioSchema = z.object({
  staffBio: z.string().max(500).nullable()
});

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type UserSettingsInput = z.infer<typeof userSettingsSchema>;
export type WarnUserInput = z.infer<typeof warnUserSchema>;
export type ModerationNoteInput = z.infer<typeof moderationNoteSchema>;
export type SetRankInput = z.infer<typeof setRankSchema>;
export type RankLockInput = z.infer<typeof rankLockSchema>;
export type CanInviteInput = z.infer<typeof canInviteSchema>;
export type InviteCountInput = z.infer<typeof inviteCountSchema>;
export type CancelInviteInput = z.infer<typeof cancelInviteSchema>;
export type DonorRankInput = z.infer<typeof donorRankSchema>;
export type GrantDonorInput = z.infer<typeof grantDonorSchema>;
export type IrcNickVerifyInput = z.infer<typeof ircNickVerifySchema>;
export type PmDraftInput = z.infer<typeof pmDraftSchema>;
export type MassPmInput = z.infer<typeof massPmSchema>;
export type SiteHistoryInput = z.infer<typeof siteHistorySchema>;
export type DncInput = z.infer<typeof dncSchema>;
export type StaffBioInput = z.infer<typeof staffBioSchema>;
