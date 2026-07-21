import { z } from 'zod';
import { RankExtraPredicate } from '@prisma/client';
import {
  normalizePermissions,
  VALID_PERMISSIONS
} from '../lib/rankPermissions';

const permissionsSchema = z
  .record(z.enum(VALID_PERMISSIONS), z.boolean())
  .optional()
  .transform((permissions) => normalizePermissions(permissions));

export const createRankSchema = z.object({
  name: z.string().trim().min(1).max(64),
  level: z.number().int().min(0),
  permissions: permissionsSchema,
  secondary: z.boolean().optional(),
  permittedForumIds: z.array(z.number().int().positive()).default([]),
  color: z.string().optional(),
  badge: z.string().optional(),
  personalCollageLimit: z.number().int().min(0).optional(),
  authorStylesheetLimit: z.number().int().min(0).optional(),
  assetByteLimit: z.number().int().min(0).optional(),
  displayStaff: z.boolean().optional(),
  staffGroupId: z.number().int().positive().nullable().optional()
});

export const updateRankSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    level: z.number().int().min(0).optional(),
    permissions: permissionsSchema,
    secondary: z.boolean().optional(),
    permittedForumIds: z.array(z.number().int().positive()).optional(),
    color: z.string().optional(),
    badge: z.string().optional(),
    personalCollageLimit: z.number().int().min(0).optional(),
    authorStylesheetLimit: z.number().int().min(0).optional(),
    assetByteLimit: z.number().int().min(0).optional(),
    displayStaff: z.boolean().optional(),
    staffGroupId: z.number().int().positive().nullable().optional()
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field required'
  });

export type CreateRankInput = z.infer<typeof createRankSchema>;
export type UpdateRankInput = z.infer<typeof updateRankSchema>;

// ─── Rank promotion rules (#170) ────────────────────────────────────────────────
// One row drives the auto-class evaluator's "from → to" rung (see
// rankProgression.ts RankPromotionRule). minContributed is bytes, so it crosses
// the wire as a string to survive values past Number.MAX_SAFE_INTEGER.

export const createPromotionRuleSchema = z
  .object({
    fromRankId: z.number().int().positive(),
    toRankId: z.number().int().positive(),
    minContributed: z.coerce.bigint().nonnegative().default(BigInt(0)),
    minRatio: z.number().min(0).default(0),
    minContributions: z.number().int().min(0).default(0),
    minAccountAgeDays: z.number().int().min(0).default(0),
    extra: z.nativeEnum(RankExtraPredicate).nullable().default(null),
    enabled: z.boolean().default(true)
  })
  .refine((v) => v.fromRankId !== v.toRankId, {
    message: 'fromRankId and toRankId must differ'
  });

export const updatePromotionRuleSchema = z
  .object({
    fromRankId: z.number().int().positive().optional(),
    toRankId: z.number().int().positive().optional(),
    minContributed: z.coerce.bigint().nonnegative().optional(),
    minRatio: z.number().min(0).optional(),
    minContributions: z.number().int().min(0).optional(),
    minAccountAgeDays: z.number().int().min(0).optional(),
    extra: z.nativeEnum(RankExtraPredicate).nullable().optional(),
    enabled: z.boolean().optional()
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field required'
  })
  .refine((v) => v.fromRankId === undefined || v.fromRankId !== v.toRankId, {
    message: 'fromRankId and toRankId must differ'
  });

export type CreatePromotionRuleInput = z.infer<
  typeof createPromotionRuleSchema
>;
export type UpdatePromotionRuleInput = z.infer<
  typeof updatePromotionRuleSchema
>;
