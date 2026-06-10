import { Bitrate, FileType, ReleaseMedia, ReleaseType } from '@prisma/client';
import { z } from 'zod';

const releaseTypeEnum = z.enum(
  Object.values(ReleaseType) as [ReleaseType, ...ReleaseType[]]
);
const fileTypeEnum = z.enum(
  Object.values(FileType) as [FileType, ...FileType[]]
);
const bitrateEnum = z.enum(Object.values(Bitrate) as [Bitrate, ...Bitrate[]]);
const mediaEnum = z.enum(
  Object.values(ReleaseMedia) as [ReleaseMedia, ...ReleaseMedia[]]
);

export const createContributionSchema = z.object({
  communityId: z.number().int().positive(),
  type: releaseTypeEnum,
  title: z.string().min(1, 'Title is required').max(256),
  year: z.number().int().min(1900).max(2100),
  fileType: fileTypeEnum,
  downloadUrl: z.string().url('A valid download URL is required'),
  sizeInBytes: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
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
  bitrate: bitrateEnum.optional(),
  media: mediaEnum.optional(),
  hasLog: z.boolean().optional().default(false),
  hasCue: z.boolean().optional().default(false),
  isScene: z.boolean().optional().default(false),
  collaborators: z
    .array(
      z.object({
        artist: z.string().min(1, 'Artist/creator name is required'),
        importance: z.string().min(1)
      })
    )
    .min(1, 'At least one artist/creator is required')
});

export type CreateContributionInput = z.infer<typeof createContributionSchema>;

export const addContributionToReleaseSchema = z.object({
  fileType: fileTypeEnum,
  downloadUrl: z.string().url('A valid download URL is required'),
  sizeInBytes: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  releaseDescription: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  bitrate: bitrateEnum.optional(),
  media: mediaEnum.optional(),
  hasLog: z.boolean().optional().default(false),
  hasCue: z.boolean().optional().default(false),
  isScene: z.boolean().optional().default(false)
});

export type AddContributionToReleaseInput = z.infer<
  typeof addContributionToReleaseSchema
>;
