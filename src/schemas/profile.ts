import { z } from 'zod';
import { externalStylesheetUrl } from './stylesheet';
import { ASSET_PATH } from '../modules/assetStore';

// An avatar renders to every viewer of a member's profile and posts, so it takes
// exactly the two forms this boundary can stand behind (#396):
//
//   /api/asset/<sha256>  self-hosted through the asset store (ADR-0026)
//   https://…            remote, https only
//
// What it no longer takes is a bare `.url()`, which admitted `ftp:` and plain
// `http:` — the same hole ADR-0024 §3 closed on `externalStylesheet`. Note what
// this does NOT do: #361 is that a remote avatar discloses IP, user agent and
// visit timing to a host the member chose, for every viewer, and https narrows
// that rather than closing it. Closing it needs the CSP's `img-src`, which stays
// open by ADR-0031 §6 and is tracked separately in #457, where the real cost of
// tightening it is BBCode `[img]`, not avatars.
//
// Empty string is the explicit "clear this slot" value, preserved from before.
// The stored value is not always a URL either way: the dev generator writes a
// literal `seeded` sentinel straight through Prisma (devTools/generators/users.ts),
// which never crosses this schema, so read paths must not assume the field parses.
export const avatarUrl = z
  .string()
  .refine((v) => {
    if (ASSET_PATH.test(v)) return true;
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Avatar must be an https:// URL or an /api/asset/<hash> path')
  .optional()
  .or(z.literal(''));

export const profileUpdateSchema = z.object({
  avatar: avatarUrl,
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
  // Donor perks render on the same profile and post surfaces as `avatar`, from
  // the same bare `.url()`, so #396 tightens them in step — a boundary that
  // covered only the field the issue named would be one a donor walks around.
  // `customIconLink` is a navigation target, not a fetched subresource: it
  // discloses nothing until a viewer clicks it, so it keeps plain `.url()`.
  customIcon: avatarUrl,
  customIconLink: z.string().url().or(z.literal('')).optional(),
  secondAvatar: avatarUrl,
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
