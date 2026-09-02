import { RatioPolicyStatus } from '@prisma/client';
import { z } from 'zod';

export const ratioPolicyOverrideSchema = z.object({
  status: z.nativeEnum(RatioPolicyStatus)
});

export type RatioPolicyOverrideInput = z.infer<
  typeof ratioPolicyOverrideSchema
>;
