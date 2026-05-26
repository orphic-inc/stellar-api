import { z } from 'zod';
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
    displayStaff: z.boolean().optional(),
    staffGroupId: z.number().int().positive().nullable().optional()
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field required'
  });

export type CreateRankInput = z.infer<typeof createRankSchema>;
export type UpdateRankInput = z.infer<typeof updateRankSchema>;
