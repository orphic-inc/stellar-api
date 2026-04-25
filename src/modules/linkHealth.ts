import { LinkHealthStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getLogger } from './logging';

const log = getLogger('linkHealth');

const TIMEOUT_MS = 10_000;
const STALE_AFTER_DAYS = 7;
// Auto-WARN a contribution when this many distinct users have reported it
const REPORT_WARN_THRESHOLD = 3;

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

  const reportCount = await prisma.contributionReport.count({
    where: { contributionId }
  });
  if (reportCount >= REPORT_WARN_THRESHOLD) {
    await prisma.contribution.update({
      where: { id: contributionId },
      data: { linkStatus: LinkHealthStatus.WARN }
    });
    log.info('Contribution auto-warned by reports', {
      contributionId,
      reportCount
    });
    // Kick off a recheck so status can be corrected if the link is actually fine
    checkContributionLink(contributionId).catch((err) =>
      log.warn('Post-report link recheck failed', { contributionId, err })
    );
  }
};
