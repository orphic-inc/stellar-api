import { z } from 'zod';
import { Top10SnapshotType } from '@prisma/client';

const RELEASE_LIMITS = [10, 100, 250] as const;
const VOTE_LIMITS = [25, 100, 250] as const;

const limitRefinement =
  (valid: readonly number[]) =>
  (v: number): boolean =>
    (valid as readonly number[]).includes(v);

export const releasesQuerySchema = z.object({
  type: z
    .enum([
      'day',
      'week',
      'month',
      'year',
      'overall',
      'consumed',
      'contributed'
    ])
    .default('day'),
  limit: z.coerce
    .number()
    .int()
    .refine(limitRefinement(RELEASE_LIMITS), {
      message: 'limit must be 10, 100, or 250'
    })
    .default(10),
  excludeTags: z.string().optional(),
  format: z
    .enum([
      'mp3',
      'flac',
      'wav',
      'ogg',
      'aac',
      'm4a',
      'm4b',
      'mp4',
      'mkv',
      'avi',
      'mov',
      'zip',
      'exe',
      'dmg',
      'apk',
      'pdf',
      'epub',
      'mobi',
      'cbz',
      'cbr'
    ])
    .optional()
});

export const usersQuerySchema = z.object({
  type: z
    .enum([
      'contributed',
      'consumed',
      'numContributions',
      'contributionSpeed',
      'consumeSpeed'
    ])
    .default('contributed'),
  limit: z.coerce
    .number()
    .int()
    .refine(limitRefinement(RELEASE_LIMITS), {
      message: 'limit must be 10, 100, or 250'
    })
    .default(10)
});

export const tagsQuerySchema = z.object({
  type: z.enum(['used', 'voted']).default('used'),
  limit: z.coerce
    .number()
    .int()
    .refine(limitRefinement(RELEASE_LIMITS), {
      message: 'limit must be 10, 100, or 250'
    })
    .default(10)
});

export const votesQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .refine(limitRefinement(VOTE_LIMITS), {
      message: 'limit must be 25, 100, or 250'
    })
    .default(25),
  tags: z.string().optional(),
  year: z.coerce.number().int().positive().optional()
});

export const historyQuerySchema = z.object({
  type: z.enum(['Daily', 'Weekly']).default('Daily'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional()
});

// POST /top10/snapshot. Sourced from the Prisma enum rather than a literal
// `z.enum(['Daily', 'Weekly'])` — unlike historyQuerySchema above, which only
// READS the column, this schema decides what gets WRITTEN to it, so it should
// not be able to drift from Top10SnapshotType. `Daily` is the default because
// that is what the route coerced every unrecognised body to before it had a
// validator, so a caller sending no body at all keeps its old behaviour.
export const snapshotSchema = z.object({
  type: z.nativeEnum(Top10SnapshotType).default(Top10SnapshotType.Daily)
});

export type ReleasesQuery = z.infer<typeof releasesQuerySchema>;
export type UsersQuery = z.infer<typeof usersQuerySchema>;
export type TagsQuery = z.infer<typeof tagsQuerySchema>;
export type VotesQuery = z.infer<typeof votesQuerySchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type SnapshotInput = z.infer<typeof snapshotSchema>;
