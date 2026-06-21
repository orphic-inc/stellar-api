import { z } from 'zod';

export const statsPeriodQuerySchema = z.object({
  period: z.enum(['Daily', 'Monthly', 'Yearly'])
});

export type StatsPeriodQuery = z.infer<typeof statsPeriodQuerySchema>;

// CRS moves on a multi-day scale, so the snapshot job skips the hourly Daily
// cascade (#94 grill) — only Monthly (daily buckets) and Yearly (weekly
// buckets) series exist. The reputation-history query rejects Daily rather than
// return a silently-empty series.
export const reputationHistoryPeriodQuerySchema = z.object({
  period: z.enum(['Monthly', 'Yearly'])
});

export type ReputationHistoryPeriodQuery = z.infer<
  typeof reputationHistoryPeriodQuerySchema
>;
