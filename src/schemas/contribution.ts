import { FileType, ReleaseType } from '@prisma/client';
import { z } from 'zod';

const releaseTypeEnum = z.enum(
  Object.values(ReleaseType) as [ReleaseType, ...ReleaseType[]]
);
const fileTypeEnum = z.enum(
  Object.values(FileType) as [FileType, ...FileType[]]
);

export const createContributionSchema = z.object({
  communityId: z.number().int().positive(),
  type: releaseTypeEnum,
  title: z.string().min(1, 'Title is required').max(256),
  year: z.number().int().min(1900).max(2100),
  fileType: fileTypeEnum,
  sizeInBytes: z.number().int().positive(),
  tags: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  image: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((value) => value || undefined),
  description: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  releaseDescription: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  collaborators: z
    .array(
      z.object({
        artist: z.string().min(1, 'Artist/creator name is required'),
        importance: z.string().min(1)
      })
    )
    .min(1, 'At least one artist/creator is required'),
  jsonFile: z.boolean().optional()
});

export type CreateContributionInput = z.infer<typeof createContributionSchema>;
