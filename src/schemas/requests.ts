import { RequestStatus, ReleaseType } from '@prisma/client';
import { z } from 'zod';

const releaseTypeEnum = z.enum(
  Object.values(ReleaseType) as [ReleaseType, ...ReleaseType[]]
);

const requestStatusEnum = z.enum(
  Object.values(RequestStatus) as [RequestStatus, ...RequestStatus[]]
);

export const createRequestSchema = z.object({
  communityId: z.number().int().positive(),
  type: releaseTypeEnum,
  title: z.string().min(1, 'Title is required').max(256),
  year: z.number().int().min(1900).max(2100).optional(),
  image: z
    .union([z.string().url(), z.literal('')])
    .optional()
    .transform((v) => v || undefined),
  description: z.string().min(1, 'Description is required'),
  bounty: z.coerce.bigint().min(BigInt(1), 'Bounty must be positive'),
  artists: z.array(z.number().int().positive()).optional()
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const addBountySchema = z.object({
  amount: z.coerce.bigint().min(BigInt(1), 'Bounty amount must be positive')
});

export const fillRequestSchema = z.object({
  contributionId: z.number().int().positive()
});

export const unfillRequestSchema = z.object({
  reason: z.string().max(500).optional()
});

export const listRequestsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  communityId: z.coerce.number().int().positive().optional(),
  status: requestStatusEnum.optional()
});

export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

export const requestIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});
