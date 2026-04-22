import { z } from 'zod';
import { CommunityType, RegistrationStatus, ReleaseType, ReleaseCategory } from '@prisma/client';

const communityTypeEnum = z.enum(Object.values(CommunityType) as [CommunityType, ...CommunityType[]]);
const registrationStatusEnum = z.enum(Object.values(RegistrationStatus) as [RegistrationStatus, ...RegistrationStatus[]]);
const releaseTypeEnum = z.enum(Object.values(ReleaseType) as [ReleaseType, ...ReleaseType[]]);
const releaseCategoryEnum = z.enum(Object.values(ReleaseCategory) as [ReleaseCategory, ...ReleaseCategory[]]);

export const createCommunitySchema = z.object({
  name: z.string().min(1, 'Name is required').max(128),
  image: z.string().url().optional(),
  type: communityTypeEnum,
  registrationStatus: registrationStatusEnum,
  staffIds: z.array(z.number().int().positive()).optional()
});

export const updateCommunitySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  image: z.string().url().optional(),
  registrationStatus: registrationStatusEnum.optional(),
  staffIds: z.array(z.number().int().positive()).optional()
});

export const createGroupSchema = z.object({
  artistId: z.number().int().positive('artistId is required'),
  title: z.string().min(1, 'Title is required').max(256),
  description: z.string().min(1, 'Description is required'),
  type: releaseTypeEnum,
  releaseType: releaseCategoryEnum,
  year: z.number().int().min(1900).max(2100),
  image: z.string().url().optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
  isEdition: z.boolean().optional(),
  edition: z.record(z.string(), z.unknown()).optional()
});

export const updateGroupSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  description: z.string().min(1).optional(),
  image: z.string().url().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  isEdition: z.boolean().optional(),
  edition: z.record(z.string(), z.unknown()).optional(),
  tagIds: z.array(z.number().int().positive()).optional()
});

export type CreateCommunityInput = z.infer<typeof createCommunitySchema>;
export type UpdateCommunityInput = z.infer<typeof updateCommunitySchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
