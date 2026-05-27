/**
 * schemas/devTools.ts
 *
 * Zod schemas for the /api/dev route.
 */

import { z } from 'zod';
import { SECTION_KEYS, PRESET_KEYS } from '../modules/devTools/types';

export const generateConfigSchema = z.object({
  seed: z.number().int().optional().default(42),
  scale: z.number().min(0.1).max(10).optional().default(1),
  preset: z.enum(PRESET_KEYS).optional().default('balanced'),
  sections: z.array(z.enum(SECTION_KEYS)).optional(),
  mode: z.enum(['isolated', 'integrated']).optional().default('isolated'),
  includeEdgeCases: z.boolean().optional().default(true),
  includeModerationData: z.boolean().optional().default(true),
  includeStatsData: z.boolean().optional().default(true),
  dryRun: z.boolean().optional().default(false),
  label: z.string().max(80).optional()
});

export type GenerateConfigInput = z.infer<typeof generateConfigSchema>;

export const runIdParamsSchema = z.object({
  id: z.string().min(1).max(40)
});
