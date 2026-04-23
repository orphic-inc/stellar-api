import { FileType } from '@prisma/client';
import { z } from 'zod';

export const createContributionSchema = z.object({
  releaseId: z.number().int().positive(),
  contributorId: z.number().int().positive(),
  releaseDescription: z.string().optional(),
  type: z.enum(Object.values(FileType) as [FileType, ...FileType[]]),
  sizeInBytes: z.number().int().positive(),
  jsonFile: z.boolean().optional(),
  collaboratorIds: z.array(z.number().int().positive()).optional()
});

export type CreateContributionInput = z.infer<typeof createContributionSchema>;
