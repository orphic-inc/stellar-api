import { z } from 'zod';
import { externalStylesheetUrl } from './stylesheet';

/**
 * A stored asset's address, as an avatar may reference it (#342). This is the
 * self-hosted arm that makes an `img-src 'self'` CSP reachable and closes the
 * hotlink disclosure in #361 — a member pointing their avatar at a host they
 * control otherwise collects IP, user agent, and timing for every viewer of
 * their profile and posts.
 *
 * Remote URLs still validate here: tightening `avatar` to self-hosted only is
 * #361's call to make, and this change is what gives that decision something to
 * migrate to. Note the deliberate ordering — the asset-path branch is tried
 * first because `z.string().url()` would not match a relative path anyway.
 */
export const avatarAssetPath = z
  .string()
  .regex(
    /^\/api\/asset\/[0-9a-f]{64}$/,
    'Avatar asset path must be /api/asset/<sha256>'
  );

export const profileUpdateSchema = z.object({
  avatar: avatarAssetPath.or(z.string().url()).optional().or(z.literal('')),
  avatarMouseoverText: z.string().max(256).optional(),
  profileTitle: z.string().max(128).optional(),
  profileInfo: z.string().max(10000).optional(),
  siteAppearance: z.string().optional(),
  externalStylesheet: externalStylesheetUrl,
  // The Registry arm of the Site Stylesheet radio (ADR-0024 §4). Nullable so the
  // UI can explicitly clear it (selecting Personal); a positive id points at an
  // authored/adopted sheet. Mutual exclusion with externalStylesheet is enforced
  // server-side in updateProfile, not here — it spans two fields' runtime values.
  activeAuthorStylesheetId: z.number().int().positive().nullable().optional(),
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

export const donorRewardUpdateSchema = z.object({
  iconMouseOverText: z.string().max(256).optional(),
  avatarMouseOverText: z.string().max(256).optional(),
  customIcon: z.string().url().or(z.literal('')).optional(),
  customIconLink: z.string().url().or(z.literal('')).optional(),
  secondAvatar: z.string().url().or(z.literal('')).optional(),
  profileInfoTitle1: z.string().max(128).optional(),
  profileInfo1: z.string().max(5000).optional(),
  profileInfoTitle2: z.string().max(128).optional(),
  profileInfo2: z.string().max(5000).optional(),
  profileInfoTitle3: z.string().max(128).optional(),
  profileInfo3: z.string().max(5000).optional(),
  profileInfoTitle4: z.string().max(128).optional(),
  profileInfo4: z.string().max(5000).optional()
});

export const donorForumTitleUpdateSchema = z.object({
  prefix: z.string().max(64).optional(),
  suffix: z.string().max(64).optional(),
  useComma: z.boolean().optional()
});

export type DonorRewardUpdateInput = z.infer<typeof donorRewardUpdateSchema>;
export type DonorForumTitleUpdateInput = z.infer<
  typeof donorForumTitleUpdateSchema
>;
