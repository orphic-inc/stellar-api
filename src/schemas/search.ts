import {
  Bitrate,
  FileType,
  ReleaseCategory,
  ReleaseMedia,
  ReleaseType,
  RequestStatus
} from '@prisma/client';
import { z } from 'zod';
import { paginationBase } from '../lib/pagination';

const releaseTypeEnum = z.enum(
  Object.values(ReleaseType) as [ReleaseType, ...ReleaseType[]]
);
const bitrateEnum = z.enum(Object.values(Bitrate) as [Bitrate, ...Bitrate[]]);
const mediaEnum = z.enum(
  Object.values(ReleaseMedia) as [ReleaseMedia, ...ReleaseMedia[]]
);
const releaseCategoryEnum = z.enum(
  Object.values(ReleaseCategory) as [ReleaseCategory, ...ReleaseCategory[]]
);
const fileTypeEnum = z.enum(
  Object.values(FileType) as [FileType, ...FileType[]]
);
const requestStatusEnum = z.enum(
  Object.values(RequestStatus) as [RequestStatus, ...RequestStatus[]]
);

export const searchReleasesQuerySchema = z.object({
  ...paginationBase,
  q: z.string().max(200).optional(),
  tags: z.string().max(500).optional(),
  tagMode: z.enum(['any', 'all']).optional().default('any'),
  orderBy: z
    .enum(['createdAt', 'year', 'consumers', 'contributors', 'random'])
    .optional()
    .default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  communityId: z
    .union([
      z.coerce.number().int().positive(),
      z.array(z.coerce.number().int().positive())
    ])
    .optional(),
  // Advanced — release-level
  artist: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  recordLabel: z.string().max(200).optional(),
  catalogueNumber: z.string().max(100).optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  yearTo: z.coerce.number().int().min(1900).max(2100).optional(),
  description: z.string().max(500).optional(),
  type: releaseTypeEnum.optional(),
  releaseType: releaseCategoryEnum.optional(),
  // Advanced — contribution-level (rip specifics)
  format: fileTypeEnum.optional(),
  bitrate: bitrateEnum.optional(),
  media: mediaEnum.optional(),
  hasLog: z.coerce.boolean().optional(),
  hasCue: z.coerce.boolean().optional(),
  isScene: z.coerce.boolean().optional(),
  vanityHouse: z.coerce.boolean().optional()
});

export type SearchReleasesQuery = z.infer<typeof searchReleasesQuerySchema>;

export const searchArtistsQuerySchema = z.object({
  ...paginationBase,
  q: z.string().max(200).optional(),
  tags: z.string().max(500).optional(),
  tagMode: z.enum(['any', 'all']).optional().default('any'),
  vanityHouse: z.coerce.boolean().optional(),
  orderBy: z.enum(['name', 'random']).optional().default('name'),
  order: z.enum(['asc', 'desc']).optional().default('asc')
});

export type SearchArtistsQuery = z.infer<typeof searchArtistsQuerySchema>;

export const searchRequestsQuerySchema = z.object({
  ...paginationBase,
  q: z.string().max(200).optional(),
  artist: z.string().max(200).optional(),
  type: releaseTypeEnum.optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  status: requestStatusEnum.optional(),
  communityId: z.coerce.number().int().positive().optional(),
  orderBy: z
    .enum(['createdAt', 'voteCount', 'random'])
    .optional()
    .default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc')
});

export type SearchRequestsQuery = z.infer<typeof searchRequestsQuerySchema>;

export const searchLogQuerySchema = z.object({
  ...paginationBase,
  q: z.string().max(200).optional(),
  type: z.enum(['topic', 'post', 'all']).optional().default('all'),
  authorId: z.coerce.number().int().positive().optional(),
  orderBy: z.enum(['createdAt']).optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc')
});

export type SearchLogQuery = z.infer<typeof searchLogQuerySchema>;

export const searchUsersQuerySchema = z.object({
  ...paginationBase,
  q: z.string().max(200).optional(),
  orderBy: z
    .enum(['username', 'createdAt', 'lastLogin'])
    .optional()
    .default('username'),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
  disabled: z.coerce.boolean().optional()
});

export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;
