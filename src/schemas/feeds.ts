import { Bitrate, FileType } from '@prisma/client';
import { z } from 'zod';

/**
 * The Member Feed's credentials (ADR-0014 §2). Parsed by the token check, not
 * by `validateQuery`: a malformed credential must answer the feed's one 404,
 * never a 400 that describes what a credential looks like.
 */
export const feedCredentialsSchema = z.object({
  user: z.coerce.number().int().positive(),
  token: z.string()
});

/**
 * `contributions.xml` filters, one value each, ANDed (ADR-0014 §3). Validated
 * only after the token check and the member limit, so an unauthenticated caller
 * never learns this vocabulary. A repeated param arrives as an array and fails.
 */
export const contributionFeedQuerySchema = z.object({
  community: z.coerce.number().int().positive().optional(),
  tag: z.string().trim().min(1).max(100).optional(),
  format: z.nativeEnum(FileType).optional(),
  bitrate: z.nativeEnum(Bitrate).optional()
});

export type ContributionFeedQuery = z.infer<typeof contributionFeedQuerySchema>;
