import { RatioPolicyStatus } from '@prisma/client';
import { z } from 'zod';
import { staffReason, memberMessage } from './user';

export const ratioPolicyOverrideSchema = z.object({
  status: z.nativeEnum(RatioPolicyStatus),
  // Required since #646: the override is audited, like #636's staff controls.
  reason: staffReason,
  message: memberMessage
});

export type RatioPolicyOverrideInput = z.infer<
  typeof ratioPolicyOverrideSchema
>;
