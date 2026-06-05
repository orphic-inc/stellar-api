import { LinkHealthStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getLogger } from './logging';

const log = getLogger('linkHealth');

const TIMEOUT_MS = 10_000;
const STALE_AFTER_DAYS = 7;
// Auto-WARN a contribution when this many distinct users have reported it
const REPORT_WARN_THRESHOLD = 3;

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

export const checkContributionLink = async (
  contributionId: number
): Promise<void> => {
  const contribution = await prisma.contribution.findUnique({
    where: { id: contributionId },
    select: { downloadUrl: true }
  });
  if (!contribution) return;

  const status = await checkUrl(contribution.downloadUrl);
  await prisma.contribution.update({
    where: { id: contributionId },
    data: { linkStatus: status, linkCheckedAt: new Date() }
  });
  log.info('Link checked', { contributionId, status });
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
    await prisma.contribution.update({
      where: { id: contributionId },
      data: { linkStatus: LinkHealthStatus.WARN }
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
};

export type CommunityPulseStatus = 'Healthy' | 'Ailing' | 'Critical' | 'Unknown';

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

  // Only PASS/FAIL are definitive; WARN (transient) and UNKNOWN (unprobed) are
  // indeterminate and excluded from the pulse.
  const checked = counts.pass + counts.fail;
  const total = checked + counts.warn + counts.unknown;
  const coverage = total === 0 ? null : checked / total;
  const pulse = checked === 0 ? null : counts.pass / checked;
  // Don't claim a confident band until enough links are actually probed —
  // otherwise one PASS among thousands of UNKNOWN would read "Healthy".
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
