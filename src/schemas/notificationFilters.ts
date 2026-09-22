import { z } from 'zod';
import {
  Bitrate,
  FileType,
  ReleaseCategory,
  ReleaseMedia,
  ReleaseType
} from '@prisma/client';
import { paginationBase } from '../lib/pagination';

/**
 * Contribution notification filters (#263, ADR-0049).
 *
 * Every list is capped at 100 entries. That bounds the cost of matching a new
 * contribution, not a member's allowance — the allowance is the rank's
 * `notificationFilterLimit`, enforced in the module.
 */
const MAX_ENTRIES = 100;

const list = <T extends z.ZodTypeAny>(item: T) =>
  z.array(item).max(MAX_ENTRIES).default([]);

const year = z.number().int().min(1000).max(9999).nullable().default(null);

export const notificationFilterSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    artistIds: list(z.number().int().positive()),
    // Names, normalized and alias-resolved in the module (#689).
    tags: list(z.string().min(1).max(50)),
    notTags: list(z.string().min(1).max(50)),
    communityIds: list(z.number().int().positive()),
    releaseTypes: list(z.nativeEnum(ReleaseType)),
    releaseCategories: list(z.nativeEnum(ReleaseCategory)),
    fileTypes: list(z.nativeEnum(FileType)),
    bitrates: list(z.nativeEnum(Bitrate)),
    media: list(z.nativeEnum(ReleaseMedia)),
    fromYear: year,
    toYear: year,
    newReleasesOnly: z.boolean().default(false),
    excludeCompilations: z.boolean().default(false),
    mainCreditsOnly: z.boolean().default(false)
  })
  .refine(
    (v) => v.fromYear === null || v.toYear === null || v.fromYear <= v.toYear,
    { message: 'fromYear must not be after toYear', path: ['fromYear'] }
  );

export const notificationFilterHitsQuerySchema = z.object({
  ...paginationBase,
  filterId: z.coerce.number().int().positive().optional(),
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
});

/** Scope for the hit writes: one filter's rows, or every filter's. */
export const notificationFilterHitScopeSchema = z.object({
  filterId: z.coerce.number().int().positive().optional()
});

export const markNotificationFilterHitReadSchema = z.object({
  contributionId: z.number().int().positive(),
  filterId: z.number().int().positive().optional()
});

export const notificationFilterCatchupSchema = z.object({
  filterId: z.number().int().positive().optional()
});

export type NotificationFilterInput = z.infer<typeof notificationFilterSchema>;
export type NotificationFilterHitsQuery = z.infer<
  typeof notificationFilterHitsQuerySchema
>;
export type NotificationFilterHitScope = z.infer<
  typeof notificationFilterHitScopeSchema
>;
export type MarkNotificationFilterHitReadInput = z.infer<
  typeof markNotificationFilterHitReadSchema
>;
export type NotificationFilterCatchupInput = z.infer<
  typeof notificationFilterCatchupSchema
>;
