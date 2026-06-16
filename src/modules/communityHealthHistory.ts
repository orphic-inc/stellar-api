import { LinkHealthStatus, StatSnapshotPeriod } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { computePulse } from './linkHealth';
import { getBucket, getRetentionCutoff } from './statsHistory';

// ─── Capture ───────────────────────────────────────────────────────────────

type CommunityStatusCountRow = {
  communityId: number;
  linkStatus: LinkHealthStatus;
  count: number;
};

/**
 * Snapshot every community's link-health pulse for the given period (#75). The
 * read-time pulse (`getCommunityHealthPulse`) and this capture share the same
 * banding via `computePulse`, so a stored snapshot matches what the live
 * endpoint reports at capture time. Mirrors `captureUserStats`: bucket, write
 * with `skipDuplicates`, then prune past the period's retention cutoff.
 *
 * Contributions on releases with no community (`Release.communityId` is
 * nullable) carry no community pulse and are excluded.
 */
export async function captureCommunityHealth(
  period: StatSnapshotPeriod
): Promise<void> {
  const bucketAt = getBucket(period);

  const rows = await prisma.$queryRaw<CommunityStatusCountRow[]>`
    SELECT r."communityId" AS "communityId",
           c."linkStatus"  AS "linkStatus",
           COUNT(*)::int    AS "count"
    FROM "contributions" c
    JOIN "releases" r ON c."releaseId" = r.id
    WHERE r."communityId" IS NOT NULL
    GROUP BY r."communityId", c."linkStatus"
  `;

  // Fold the per-(community, status) rows into per-community counts.
  const byCommunity = new Map<
    number,
    { pass: number; warn: number; fail: number; unknown: number }
  >();
  for (const row of rows) {
    let counts = byCommunity.get(row.communityId);
    if (!counts) {
      counts = { pass: 0, warn: 0, fail: 0, unknown: 0 };
      byCommunity.set(row.communityId, counts);
    }
    switch (row.linkStatus) {
      case LinkHealthStatus.PASS:
        counts.pass += row.count;
        break;
      case LinkHealthStatus.WARN:
        counts.warn += row.count;
        break;
      case LinkHealthStatus.FAIL:
        counts.fail += row.count;
        break;
      default:
        counts.unknown += row.count; // UNKNOWN — not yet probed
        break;
    }
  }

  if (byCommunity.size > 0) {
    const data = Array.from(byCommunity, ([communityId, counts]) => {
      const p = computePulse(counts);
      return {
        communityId,
        period,
        bucketAt,
        pass: p.pass,
        warn: p.warn,
        fail: p.fail,
        unknown: p.unknown,
        total: p.total,
        checked: p.checked,
        coverage: p.coverage,
        pulse: p.pulse,
        status: p.status
      };
    });

    await prisma.communityHealthSnapshot.createMany({
      data,
      skipDuplicates: true
    });
  }

  await prisma.communityHealthSnapshot.deleteMany({
    where: { period, capturedAt: { lt: getRetentionCutoff(period) } }
  });
}

// ─── Query ─────────────────────────────────────────────────────────────────

/**
 * A community's health-pulse history for the given period, oldest-first — the
 * time-series behind the single read-time `GET /:id/health` heartbeat.
 */
export async function getCommunityHealthHistory(
  communityId: number,
  period: StatSnapshotPeriod
) {
  return prisma.communityHealthSnapshot.findMany({
    where: { communityId, period },
    orderBy: { capturedAt: 'asc' }
  });
}
