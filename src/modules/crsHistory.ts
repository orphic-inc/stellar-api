import { Prisma, StatSnapshotPeriod } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getReputation } from './reputation';
import { getBucket, getRetentionCutoff } from './statsHistory';

// ─── Capture ───────────────────────────────────────────────────────────────

/**
 * Only recently-active accounts are snapshotted. Unlike `captureUserStats`,
 * which folds all users in a single cheap SQL `groupBy`, a CRS read recomputes
 * ~8 queries per user (`getReputation`), so snapshotting every account each
 * cascade would be a query storm. A dormant account earns no trend line until
 * it returns — its score is still always available live (ADR-0007). One uniform
 * window across all periods; the per-period retention cutoff prunes the series.
 */
const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** How many users' CRS we recompute concurrently per chunk — bounds the burst
 *  of parallel `getReputation` reads against the DB. */
const CONCURRENCY = 25;

/**
 * Snapshot the CRS (overall score + dimension breakdown) of every recently
 * active user for the given period (#94) — the additive trend layer ADR-0007
 * deferred. The value stays computed-on-read; this is a captured read, never
 * the source of truth. Mirrors `captureCommunityHealth`: bucket, write with
 * `skipDuplicates`, then prune past the period's retention cutoff.
 */
export async function captureCrsSnapshots(
  period: StatSnapshotPeriod
): Promise<void> {
  const bucketAt = getBucket(period);

  const users = await prisma.user.findMany({
    where: {
      disabled: false,
      lastLogin: { gte: new Date(Date.now() - ACTIVE_WINDOW_MS) }
    },
    select: { id: true }
  });

  // Recompute CRS in concurrency-bounded chunks rather than fanning out every
  // active user's ~8-query read at once.
  const data: Prisma.CrsSnapshotCreateManyInput[] = [];
  for (let i = 0; i < users.length; i += CONCURRENCY) {
    const chunk = users.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (u) => {
        const crs = await getReputation(u.id);
        return {
          userId: u.id,
          period,
          bucketAt,
          score: crs.score,
          dimensions: crs.dimensions as unknown as Prisma.InputJsonValue
        };
      })
    );
    data.push(...results);
  }

  if (data.length > 0) {
    await prisma.crsSnapshot.createMany({ data, skipDuplicates: true });
  }

  await prisma.crsSnapshot.deleteMany({
    where: { period, capturedAt: { lt: getRetentionCutoff(period) } }
  });
}

// ─── Query ─────────────────────────────────────────────────────────────────

/** Periods the CRS series actually captures — Daily is intentionally skipped
 *  (see `captureCrsSnapshots`), so the read surface never offers it. */
export type CrsHistoryPeriod = Exclude<StatSnapshotPeriod, 'Daily'>;

/**
 * A user's CRS history for the given period, oldest-first — the time-series
 * behind the single read-time `GET /me/reputation` score. Each row's `score` +
 * `dimensions` are the FULL, unfiltered CRS as captured (store-raw / gate-on-
 * read, like `UserStatSnapshot`'s raw bytes).
 *
 * This is the self-only view (`GET /profile/me/reputation/history`), so it
 * returns the breakdown verbatim. When the trend is later surfaced on OTHER
 * users' profiles (the deferred `/user/:id` gated trend, tracked in #210), that
 * caller MUST replay the #193 profile gating per row: the `canSeeRatio`
 * block-gate (`profile.ts`) and the per-row `filterReputationView`
 * (`reputation.ts`) that drops the snatch-derived `ratio` dimension and
 * recomputes the score — never expose this raw series cross-account unfiltered.
 */
export async function getCrsHistory(userId: number, period: CrsHistoryPeriod) {
  const rows = await prisma.crsSnapshot.findMany({
    where: { userId, period },
    orderBy: { capturedAt: 'asc' }
  });
  return rows.map((row) => ({
    capturedAt: row.capturedAt.toISOString(),
    period: row.period,
    score: row.score,
    dimensions: row.dimensions
  }));
}
