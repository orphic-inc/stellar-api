import { LinkHealthStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getLogger } from './logging';
import { sendSystemMessage } from './pm';

const log = getLogger('linkHealth');

const TIMEOUT_MS = 10_000;
const STALE_AFTER_DAYS = 7;
// Auto-WARN a contribution when this many distinct users have reported it
const REPORT_WARN_THRESHOLD = 3;
// A contribution stuck at WARN this long is promoted to FAIL (ADR-0006)
const WARN_SWEEP_AFTER_MS = 72 * 60 * 60 * 1000;

// Community pulse bands — the share of *definitively probed* links that PASS.
const PULSE_HEALTHY = 0.9;
const PULSE_AILING = 0.6;
// Below this share of links definitively probed, the pulse isn't trustworthy
// enough to band — report Unknown rather than a confident Healthy/Critical.
const PULSE_MIN_COVERAGE = 0.5;

export const checkUrl = async (url: string): Promise<LinkHealthStatus> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow'
    });
    if (res.ok) return LinkHealthStatus.PASS;
    // 5xx is likely transient; 4xx is a confirmed dead link
    return res.status >= 500 ? LinkHealthStatus.WARN : LinkHealthStatus.FAIL;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError')
      return LinkHealthStatus.WARN;
    return LinkHealthStatus.FAIL;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Accrue confirmed-PASS uptime for the lifetime link-health CRS dimension
 * (ADR-0019, #95). Pure: a function of the NEW status and the current open-
 * segment clock only. `healthySince` is itself the accrual-state flag, so the
 * prior status is irrelevant and the result is idempotent / self-healing —
 * dropping the same block into any status writer converges the columns to
 * correct even if a transition was once missed. Returns the next
 * `(healthyMs, healthySince)` to persist alongside the status write. Only PASS
 * accrues; UNKNOWN/WARN/FAIL do not — stricter than ADR-0006 ratio relief
 * (which counts everything but FAIL), because a positive reward must credit
 * confirmed health only and can't be inflated by unconfirmed/suspect links.
 */
export const applyHealthAccrual = (
  status: LinkHealthStatus,
  current: { healthyMs: bigint; healthySince: Date | null },
  now: Date
): { healthyMs: bigint; healthySince: Date | null } => {
  const isPass = status === LinkHealthStatus.PASS;
  if (isPass && current.healthySince === null) {
    // Open (or self-heal) the segment.
    return { healthyMs: current.healthyMs, healthySince: now };
  }
  if (!isPass && current.healthySince !== null) {
    // Bank the open segment and close it.
    const elapsed = BigInt(now.getTime() - current.healthySince.getTime());
    return {
      healthyMs: current.healthyMs + (elapsed > 0n ? elapsed : 0n),
      healthySince: null
    };
  }
  // PASS while already accruing, or non-PASS while not accruing: no change.
  return { healthyMs: current.healthyMs, healthySince: current.healthySince };
};

export const checkContributionLink = async (
  contributionId: number
): Promise<void> => {
  const contribution = await prisma.contribution.findUnique({
    where: { id: contributionId },
    select: {
      downloadUrl: true,
      linkStatus: true,
      linkStatusChangedAt: true,
      healthyMs: true,
      healthySince: true
    }
  });
  if (!contribution) return;

  const status = await checkUrl(contribution.downloadUrl);
  const now = new Date();
  // Stamp the transition time when the status actually changes — or when it's
  // never been stamped (backfill) — so the WARN sweep has a clock to read.
  const stampChange =
    status !== contribution.linkStatus ||
    contribution.linkStatusChangedAt === null;
  const accrual = applyHealthAccrual(
    status,
    {
      healthyMs: contribution.healthyMs,
      healthySince: contribution.healthySince
    },
    now
  );
  await prisma.contribution.update({
    where: { id: contributionId },
    data: {
      linkStatus: status,
      linkCheckedAt: now,
      healthyMs: accrual.healthyMs,
      healthySince: accrual.healthySince,
      ...(stampChange ? { linkStatusChangedAt: now } : {})
    }
  });
  log.info('Link checked', { contributionId, status });
};

// Promote contributions stuck at WARN past the sweep window to FAIL. Suspicion
// alone never revokes ratio relief; only a confirmed-or-persistent FAIL does
// (ADR-0006). This closes the "returns 200 but the file is gone" hole.
export const sweepStaleWarnLinks = async (): Promise<void> => {
  const cutoff = new Date(Date.now() - WARN_SWEEP_AFTER_MS);
  const now = new Date();

  // Capture who/what is about to be promoted BEFORE the bulk update, so the
  // affected contributors can be PM'd (updateMany returns only a count). The
  // window between this read and the update is harmless: at worst a link that
  // recovered in between is re-PM'd, and the update's own WHERE is the source of
  // truth for the status change.
  const promoting = await prisma.contribution.findMany({
    where: {
      linkStatus: LinkHealthStatus.WARN,
      linkStatusChangedAt: { lt: cutoff }
    },
    select: { id: true, userId: true, release: { select: { title: true } } }
  });
  if (promoting.length === 0) return;

  await prisma.contribution.updateMany({
    where: { id: { in: promoting.map((c) => c.id) } },
    data: { linkStatus: LinkHealthStatus.FAIL, linkStatusChangedAt: now }
  });
  log.info('Swept stale WARN links to FAIL', { count: promoting.length });

  await notifyContributorsOfDeadLinks(promoting);
};

type PromotedContribution = { userId: number; release: { title: string } };

/**
 * PRD-06 #2: tell each contributor when a link of theirs is swept to FAIL, so a
 * silent ratio-relief loss doesn't blindside them. Batched to one System PM per
 * contributor (a sweep can fail several of a user's links at once). Best-effort:
 * a PM failure is logged but never blocks the status change, which already
 * landed above.
 */
const notifyContributorsOfDeadLinks = async (
  promoted: PromotedContribution[]
): Promise<void> => {
  const titlesByUser = new Map<number, string[]>();
  for (const c of promoted) {
    const titles = titlesByUser.get(c.userId) ?? [];
    titles.push(c.release.title);
    titlesByUser.set(c.userId, titles);
  }

  for (const [userId, titles] of titlesByUser) {
    const one = titles.length === 1;
    const list = titles.map((t) => `• ${t}`).join('\n');
    const subject = `Contribution ${
      one ? 'link' : 'links'
    } no longer reachable`;
    const body =
      `A health check could not reach the download ${one ? 'link' : 'links'} ` +
      `for the following contribution${one ? '' : 's'} of yours, so ` +
      `${one ? 'it has' : 'they have'} been marked dead and no longer count ` +
      `toward your ratio relief:\n\n${list}\n\n` +
      `Re-upload or refresh the link to restore relief. This is an automated ` +
      `notice — replies are not monitored.`;

    try {
      await sendSystemMessage(userId, subject, body);
    } catch (err) {
      log.warn('System link-fail PM failed', { userId, err });
    }
  }
};

export const recheckStaleLinks = async (): Promise<void> => {
  const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000);
  const stale = await prisma.contribution.findMany({
    where: {
      linkStatus: { not: LinkHealthStatus.FAIL },
      OR: [{ linkCheckedAt: null }, { linkCheckedAt: { lt: cutoff } }]
    },
    select: { id: true }
  });
  log.info('Rechecking stale links', { count: stale.length });
  for (const { id } of stale) {
    await checkContributionLink(id).catch((err) =>
      log.warn('Link recheck failed', { contributionId: id, err })
    );
  }
};

export const recordContributionReport = async (
  contributionId: number,
  reporterId: number,
  reason: string
): Promise<void> => {
  await prisma.contributionReport.create({
    data: { contributionId, reporterId, reason }
  });

  // Count distinct reporters so one user filing multiple reports can't trigger WARN alone
  const distinctReporters = await prisma.contributionReport.findMany({
    where: { contributionId },
    select: { reporterId: true },
    distinct: ['reporterId']
  });
  if (distinctReporters.length >= REPORT_WARN_THRESHOLD) {
    const current = await prisma.contribution.findUnique({
      where: { id: contributionId },
      select: { linkStatus: true, healthyMs: true, healthySince: true }
    });
    // Only warn from a healthy/unknown state: don't reset the sweep clock on
    // an already-WARN link, and don't downgrade a confirmed FAIL back to WARN.
    if (
      current &&
      current.linkStatus !== LinkHealthStatus.WARN &&
      current.linkStatus !== LinkHealthStatus.FAIL
    ) {
      const now = new Date();
      // Bank any open PASS segment before flipping to WARN (same accrual block
      // as checkContributionLink — ADR-0019). Don't rely on the async recheck
      // below landing to close the segment.
      const accrual = applyHealthAccrual(
        LinkHealthStatus.WARN,
        { healthyMs: current.healthyMs, healthySince: current.healthySince },
        now
      );
      await prisma.contribution.update({
        where: { id: contributionId },
        data: {
          linkStatus: LinkHealthStatus.WARN,
          linkStatusChangedAt: now,
          healthyMs: accrual.healthyMs,
          healthySince: accrual.healthySince
        }
      });
      log.info('Contribution auto-warned by reports', {
        contributionId,
        distinctReporters: distinctReporters.length
      });
      // Kick off a recheck so status can be corrected if the link is actually fine
      checkContributionLink(contributionId).catch((err) =>
        log.warn('Post-report link recheck failed', { contributionId, err })
      );
    }
  }
};

export type CommunityPulseStatus =
  | 'Healthy'
  | 'Ailing'
  | 'Critical'
  | 'Unknown';

export interface CommunityHealthPulse {
  pass: number;
  warn: number;
  fail: number;
  unknown: number;
  /** All contributions in the community. */
  total: number;
  /**
   * Definitively probed links (PASS + FAIL). WARN is transient/uncertain and
   * UNKNOWN is unprobed — both are indeterminate and excluded from the pulse.
   */
  checked: number;
  /** Share of all links that are definitively probed, 0–1. `null` when empty. */
  coverage: number | null;
  /** Share of probed links that PASS, 0–1. `null` when none are probed yet. */
  pulse: number | null;
  status: CommunityPulseStatus;
}

/**
 * Pure pulse computation: turn a community's PASS/WARN/FAIL/UNKNOWN counts into
 * the banded heartbeat. Shared by the read-time pulse and the snapshot capture
 * (#75) so the coverage floor + banding logic lives in exactly one place.
 *
 * Only PASS/FAIL are definitive; WARN (transient) and UNKNOWN (unprobed) are
 * indeterminate and excluded from the pulse. The band is withheld (`Unknown`)
 * until coverage clears the floor — otherwise one PASS among thousands of
 * UNKNOWN would read "Healthy".
 */
export const computePulse = (counts: {
  pass: number;
  warn: number;
  fail: number;
  unknown: number;
}): CommunityHealthPulse => {
  const checked = counts.pass + counts.fail;
  const total = checked + counts.warn + counts.unknown;
  const coverage = total === 0 ? null : checked / total;
  const pulse = checked === 0 ? null : counts.pass / checked;
  const status: CommunityPulseStatus =
    pulse === null || coverage === null || coverage < PULSE_MIN_COVERAGE
      ? 'Unknown'
      : pulse >= PULSE_HEALTHY
      ? 'Healthy'
      : pulse >= PULSE_AILING
      ? 'Ailing'
      : 'Critical';

  return { ...counts, total, checked, coverage, pulse, status };
};

/**
 * The community's link-health "pulse": roll every contribution's linkStatus up
 * into a single heartbeat. A living community keeps its links alive; the pulse
 * weakens as they rot. Computed on read — no stored state.
 */
export const getCommunityHealthPulse = async (
  communityId: number
): Promise<CommunityHealthPulse> => {
  const grouped = await prisma.contribution.groupBy({
    by: ['linkStatus'],
    where: { release: { communityId } },
    _count: { _all: true }
  });

  const counts = { pass: 0, warn: 0, fail: 0, unknown: 0 };
  for (const row of grouped) {
    const n = row._count._all;
    switch (row.linkStatus) {
      case LinkHealthStatus.PASS:
        counts.pass += n;
        break;
      case LinkHealthStatus.WARN:
        counts.warn += n;
        break;
      case LinkHealthStatus.FAIL:
        counts.fail += n;
        break;
      default:
        counts.unknown += n; // UNKNOWN — not yet probed
        break;
    }
  }

  return computePulse(counts);
};
