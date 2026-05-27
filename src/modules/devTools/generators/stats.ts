/**
 * devTools/generators/stats.ts
 *
 * Generates UserStatSnapshot, SiteStatSnapshot, and Top10Snapshot rows
 * so that historical charts, leaderboards, and percentile views have data.
 *
 * Direct Prisma inserts are used here (not the statsJob) because the
 * job runs live and would need real traffic data. Reconcile ensures
 * vote aggregates are consistent.
 *
 * Coverage:
 *   Models: UserStatSnapshot, SiteStatSnapshot, Top10Snapshot, Top10SnapshotEntry
 *   Edge cases: sparse activity (many zero-value days), trend up/down over time
 */

import { PrismaClient } from '@prisma/client';
import { RunContext } from '../types';
import { randInt, randBool, SeedContext } from '../seedRandom';
import { trackCreate, trackManyCreated } from '../tracking';

function daysBackDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function generateStats(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  const { config, runId } = ctx;
  const rng = new SeedContext(config.seed).fork('stats');

  if (!config.includeStatsData) return;
  if (ctx.generatedUserIds.length === 0) return;

  const users = ctx.generatedUserIds;
  const releases = ctx.generatedReleaseIds;

  // ─── UserStatSnapshot ─────────────────────────────────────────────────────

  // 90 daily snapshots for each generated user
  const DAYS = 90;
  const userStatIds: number[] = [];

  for (const userId of users) {
    let cumulativeContributed = 0n;
    let cumulativeConsumed = 0n;
    let cumulativeContribCount = 0;

    for (let d = DAYS; d >= 0; d--) {
      const bucketAt = daysBackDate(d);
      // Simulate variable activity (more on weekdays)
      const dayOfWeek = bucketAt.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const activityFactor = isWeekend ? 0.3 : 1.0;

      if (randBool(0.3 * activityFactor, rng)) {
        cumulativeContributed += BigInt(randInt(0, 100_000_000, rng));
      }
      if (randBool(0.5 * activityFactor, rng)) {
        cumulativeConsumed += BigInt(randInt(0, 500_000_000, rng));
      }
      if (randBool(0.1 * activityFactor, rng)) {
        cumulativeContribCount += randInt(0, 3, rng);
      }

      try {
        const snap = await prisma.userStatSnapshot.create({
          data: {
            userId,
            period: 'Daily',
            bucketAt,
            capturedAt: bucketAt,
            contributed: cumulativeContributed,
            consumed: cumulativeConsumed,
            contributionCount: cumulativeContribCount
          }
        });
        userStatIds.push(snap.id);
      } catch {
        // Duplicate (period+bucketAt+userId) — skip
      }
    }
  }

  // Track in bulk
  if (userStatIds.length > 0) {
    await trackManyCreated(
      prisma as Parameters<typeof trackManyCreated>[0],
      runId,
      'UserStatSnapshot',
      userStatIds
    );
  }

  // ─── SiteStatSnapshot ─────────────────────────────────────────────────────

  const siteSnapIds: number[] = [];
  const totalUsers = users.length;
  const totalReleases = releases.length;

  for (let d = DAYS; d >= 0; d--) {
    const bucketAt = daysBackDate(d);
    const dayFactor = (DAYS - d) / DAYS; // increasing trend over time

    try {
      const snap = await prisma.siteStatSnapshot.create({
        data: {
          bucketAt,
          capturedAt: bucketAt,
          maxUsers: Math.round(totalUsers * 1.5),
          totalUsers,
          enabledUsers: Math.round(totalUsers * 0.95),
          activeToday: Math.round(
            totalUsers * dayFactor * 0.3 + randInt(1, 5, rng)
          ),
          activeThisWeek: Math.round(
            totalUsers * dayFactor * 0.6 + randInt(1, 10, rng)
          ),
          activeThisMonth: Math.round(
            totalUsers * dayFactor * 0.8 + randInt(1, 15, rng)
          ),
          communities: ctx.generatedCommunityIds.length,
          releases: Math.round(totalReleases * dayFactor + randInt(0, 5, rng)),
          artists: ctx.generatedArtistIds.length,
          blogPosts: randInt(0, 3, rng),
          announcements: randInt(0, 2, rng),
          comments: randInt(0, 20, rng),
          contributedLinks: ctx.generatedContributionIds.length,
          contributedLinkDownloads: randInt(0, 50, rng)
        }
      });
      siteSnapIds.push(snap.id);
    } catch {
      // Duplicate bucketAt — skip
    }
  }

  if (siteSnapIds.length > 0) {
    await trackManyCreated(
      prisma as Parameters<typeof trackManyCreated>[0],
      runId,
      'SiteStatSnapshot',
      siteSnapIds
    );
  }

  // ─── Top10Snapshot ────────────────────────────────────────────────────────

  if (releases.length > 0) {
    const snapshotTypes = ['Daily', 'Weekly'] as const;
    const snapshotIds: number[] = [];

    for (const snapType of snapshotTypes) {
      const snapsCount = snapType === 'Daily' ? 7 : 4;
      for (let s = 0; s < snapsCount; s++) {
        const daysAgo = snapType === 'Daily' ? s : s * 7;
        const createdAt = daysBackDate(daysAgo);

        const snapshot = await prisma.top10Snapshot.create({
          data: { type: snapType, createdAt }
        });
        snapshotIds.push(snapshot.id);
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'Top10Snapshot',
          { id: snapshot.id }
        );

        // Top 10 entries — pick from generated releases
        const topReleases = releases.slice(0, Math.min(10, releases.length));
        for (let rank = 0; rank < topReleases.length; rank++) {
          const releaseId = topReleases[rank];
          // Fetch release title for the snapshot
          const rel = await prisma.release.findUnique({
            where: { id: releaseId },
            select: { title: true, releaseTags: { include: { tag: true } } }
          });
          if (!rel) continue;

          const tagString = rel.releaseTags
            .map((rt) => rt.tag.name)
            .slice(0, 5)
            .join(' ');

          const entry = await prisma.top10SnapshotEntry.create({
            data: {
              snapshotId: snapshot.id,
              rank: rank + 1,
              releaseId,
              releaseTitle: rel.title.substring(0, 255),
              tagString: tagString.substring(0, 255)
            }
          });
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'Top10SnapshotEntry',
            { id: entry.id }
          );
        }
      }
    }
  }

  ctx.summary['UserStatSnapshot'] = userStatIds.length;
  ctx.summary['SiteStatSnapshot'] = siteSnapIds.length;
}
