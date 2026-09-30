import { prisma } from '../lib/prisma';
import {
  Prisma,
  type ReleaseReportCategory,
  type ReportStatus,
  type ReportTargetType
} from '@prisma/client';
import type { ReportResolutionAction } from '../schemas/reports';
import { audit } from '../lib/audit';
import { getLogger } from './logging';
import { sendSystemMessage } from './pm';
import { resolveSourceUrls, type SourceViewer } from './reportSourceUrls';

const log = getLogger('reports');

const PAGE_SIZE = 25;

const userSelect = {
  id: true,
  username: true,
  avatar: true
} as const;

export const reportInclude = {
  reporter: { select: userSelect },
  claimedBy: { select: userSelect },
  resolvedBy: { select: userSelect },
  notes: {
    orderBy: { createdAt: 'asc' as const },
    include: { author: { select: userSelect } }
  }
} as const;

export type ReportRow = Prisma.ReportGetPayload<{
  include: typeof reportInclude;
}> & { sourceUrl: string | null };

export type ReportNoteRow = Prisma.ReportNoteGetPayload<{
  include: { author: { select: { id: true; username: true; avatar: true } } };
}>;

export type ReportSummary = {
  id: number;
  targetType: ReportTargetType;
  targetId: number;
  category: string;
  releaseCategory: ReleaseReportCategory | null;
  status: ReportStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
  sourceUrl: string | null;
};

// ─── UI deep-link paths ───────────────────────────────────────────────────────

// The rest live with the source url resolver, in reportSourceUrls.ts.
const reportPath = (reportId: number): string => `/reports/${reportId}`;

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fileReport(
  reporterId: number,
  opts: {
    targetType: ReportTargetType;
    targetId: number;
    category: string;
    releaseCategory?: ReleaseReportCategory;
    reason: string;
    evidence?: string;
  }
): Promise<{ ok: true; report: ReportRow }> {
  const { targetType, targetId, category, releaseCategory, reason, evidence } =
    opts;
  const report = await prisma.report.create({
    data: {
      reporterId,
      targetType,
      targetId,
      category,
      releaseCategory,
      reason,
      evidence
    },
    include: reportInclude
  });
  return { ok: true as const, report: { ...report, sourceUrl: null } };
}

export async function listReports(opts: {
  page: number;
  status: ReportStatus | 'all';
  targetType: ReportTargetType | 'all';
  claimedByMe: boolean;
  staffUserId: number;
  reporterUsername?: string;
}) {
  const {
    page,
    status,
    targetType,
    claimedByMe,
    staffUserId,
    reporterUsername
  } = opts;

  const where: Prisma.ReportWhereInput = {};
  if (status !== 'all') {
    where.status =
      claimedByMe && status === 'Open' ? { in: ['Open', 'Claimed'] } : status;
  }
  if (targetType !== 'all') where.targetType = targetType;
  if (claimedByMe) where.claimedById = staffUserId;

  if (reporterUsername) {
    const reporter = await prisma.user.findFirst({
      where: { username: { equals: reporterUsername, mode: 'insensitive' } },
      select: { id: true }
    });
    if (!reporter) return { total: 0, page, pageSize: PAGE_SIZE, reports: [] };
    where.reporterId = reporter.id;
  }

  const [total, rawReports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: reportInclude
    })
  ]);

  const urlMap = await resolveSourceUrls(
    rawReports.map((r) => ({
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId
    }))
  );
  const reports: ReportRow[] = rawReports.map((r) => ({
    ...r,
    sourceUrl: urlMap.get(r.id) ?? null
  }));

  return { total, page, pageSize: PAGE_SIZE, reports };
}

/**
 * One report, for staff or for its reporter. The reporter's `sourceUrl` is
 * resolved as them (#773), as in `listMyReports`; staff see every link.
 */
export async function getReport(
  id: number,
  requester: SourceViewer,
  isStaff: boolean
) {
  const report = await prisma.report.findUnique({
    where: { id },
    include: reportInclude
  });
  if (!report) return { ok: false as const, reason: 'not_found' };
  if (!isStaff && report.reporterId !== requester.id) {
    return { ok: false as const, reason: 'forbidden' };
  }
  const urlMap = await resolveSourceUrls(
    [
      {
        id: report.id,
        targetType: report.targetType,
        targetId: report.targetId
      }
    ],
    isStaff ? undefined : requester
  );
  return {
    ok: true as const,
    report: { ...report, sourceUrl: urlMap.get(report.id) ?? null }
  };
}

/** The claim fields a refusal is decided from. */
const claimStateSelect = { status: true, claimedById: true } as const;

/**
 * Why a claim moved nothing, from the report as it now is. Only called after
 * the compare-and-swap missed, so a report that reads as claimable changed
 * back meanwhile, and another staff member holds it for all this caller knows.
 */
const claimRefusal = (
  report: { status: ReportStatus; claimedById: number | null } | null
) => {
  if (!report) return 'not_found' as const;
  if (report.status === 'Resolved') return 'resolved' as const;
  return 'already_claimed' as const;
};

/**
 * Claim a report. A compare-and-swap, like `resolveReport`: it moves only a
 * report that is not resolved and is unclaimed or already this caller's, so a
 * claim cannot reopen a report resolved after the caller loaded it, nor take
 * one another staff member claimed meanwhile (#802).
 */
export async function claimReport(id: number, staffUserId: number) {
  const { count } = await prisma.report.updateMany({
    where: {
      id,
      status: { not: 'Resolved' },
      OR: [{ claimedById: null }, { claimedById: staffUserId }]
    },
    data: { status: 'Claimed', claimedById: staffUserId, claimedAt: new Date() }
  });
  if (count === 0) {
    const report = await prisma.report.findUnique({
      where: { id },
      select: claimStateSelect
    });
    return { ok: false as const, reason: claimRefusal(report) };
  }

  await audit(prisma, staffUserId, 'report.claim', 'Report', id);
  return { ok: true as const };
}

/** Why an unclaim moved nothing, from the report as it now is. */
const unclaimRefusal = (
  report: { status: ReportStatus; claimedById: number | null } | null
) => {
  if (!report) return 'not_found' as const;
  if (report.status !== 'Claimed') return 'not_claimed' as const;
  return 'forbidden' as const;
};

/**
 * Release this caller's claim. A compare-and-swap on "claimed by me", so an
 * unclaim cannot reopen a report resolved after the caller loaded it (#802).
 */
export async function unclaimReport(id: number, staffUserId: number) {
  const { count } = await prisma.report.updateMany({
    where: { id, status: 'Claimed', claimedById: staffUserId },
    data: { status: 'Open', claimedById: null, claimedAt: null }
  });
  if (count === 0) {
    const report = await prisma.report.findUnique({
      where: { id },
      select: claimStateSelect
    });
    return { ok: false as const, reason: unclaimRefusal(report) };
  }

  await audit(prisma, staffUserId, 'report.unclaim', 'Report', id);
  return { ok: true as const };
}

export async function resolveReport(
  id: number,
  staffUserId: number,
  resolution: string,
  resolutionAction: ReportResolutionAction
) {
  // Atomic compare-and-swap: only updates rows not yet resolved.
  // Prevents a race where two staff members resolve simultaneously.
  const result = await prisma.report.updateMany({
    where: { id, status: { not: 'Resolved' } },
    data: {
      status: 'Resolved',
      resolvedById: staffUserId,
      resolvedAt: new Date(),
      resolution,
      resolutionAction,
      claimedById: null,
      claimedAt: null
    }
  });

  if (result.count === 0) {
    const exists = await prisma.report.findUnique({
      where: { id },
      select: { id: true }
    });
    return exists
      ? { ok: false as const, reason: 'already_resolved' }
      : { ok: false as const, reason: 'not_found' };
  }

  await audit(prisma, staffUserId, 'report.resolve', 'Report', id, {
    resolutionAction
  });

  // Fire-and-forget: let the reporter know their report was resolved. Runs
  // after the CAS commits, in its own try/catch — a PM failure must never
  // roll back or fail the resolve (#273).
  try {
    const report = await prisma.report.findUnique({
      where: { id },
      select: { reporterId: true }
    });
    if (report) {
      await sendSystemMessage(
        report.reporterId,
        'Your report has been resolved',
        `Your report has been resolved.\n\n` +
          `Action taken: ${resolutionAction}\n` +
          `Resolution: ${resolution}\n\n` +
          `View your report: ${reportPath(id)}`
      );
    }
  } catch (err) {
    log.warn('System report-resolved PM failed', { reportId: id, err });
  }

  return { ok: true as const };
}

export async function addNote(id: number, authorId: number, body: string) {
  const report = await prisma.report.findUnique({
    where: { id },
    select: { id: true }
  });
  if (!report) return { ok: false as const, reason: 'not_found' };

  const note = await prisma.reportNote.create({
    data: { reportId: id, authorId, body },
    include: { author: { select: userSelect } }
  });
  return { ok: true as const, note };
}

/**
 * The reporter's own reports. Each `sourceUrl` is resolved as the reporter
 * (#773): a target they cannot see links nowhere, as a missing one does.
 */
export async function listMyReports(viewer: SourceViewer, page: number) {
  const where = { reporterId: viewer.id };
  const [total, rawReports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        targetType: true,
        targetId: true,
        category: true,
        releaseCategory: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        resolution: true
      }
    })
  ]);

  const urlMap = await resolveSourceUrls(
    rawReports.map((r) => ({
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId
    })),
    viewer
  );
  const reports: ReportSummary[] = rawReports.map((r) => ({
    ...r,
    sourceUrl: urlMap.get(r.id) ?? null
  }));

  return { total, page, pageSize: PAGE_SIZE, reports };
}

export async function getReportCounts() {
  const [open, claimed] = await Promise.all([
    prisma.report.count({ where: { status: 'Open' } }),
    prisma.report.count({ where: { status: 'Claimed' } })
  ]);
  return { open, claimed };
}

export async function getReportStats() {
  const now = new Date();
  const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const agoWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const agoMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const resolvedWhere = { status: 'Resolved' as const };

  const [last24h, lastWeek, lastMonth, allTime, byStaffRaw] = await Promise.all(
    [
      prisma.report.count({
        where: { ...resolvedWhere, resolvedAt: { gte: ago24h } }
      }),
      prisma.report.count({
        where: { ...resolvedWhere, resolvedAt: { gte: agoWeek } }
      }),
      prisma.report.count({
        where: { ...resolvedWhere, resolvedAt: { gte: agoMonth } }
      }),
      prisma.report.count({ where: resolvedWhere }),
      prisma.report.groupBy({
        by: ['resolvedById'],
        where: { ...resolvedWhere, resolvedById: { not: null } },
        _count: { id: true },
        orderBy: [{ _count: { id: 'desc' } }, { resolvedById: 'asc' }],
        take: 20
      })
    ]
  );

  const resolverIds = byStaffRaw
    .map((r) => r.resolvedById)
    .filter((id): id is number => id !== null);

  const resolvers = await prisma.user.findMany({
    where: { id: { in: resolverIds } },
    select: { id: true, username: true }
  });
  const usernameById = new Map(resolvers.map((u) => [u.id, u.username]));

  const byStaff = byStaffRaw
    .filter((r) => r.resolvedById !== null)
    .map((r) => ({
      userId: r.resolvedById!,
      username: usernameById.get(r.resolvedById!) ?? 'Unknown',
      count: r._count.id
    }));

  return { last24h, lastWeek, lastMonth, allTime, byStaff };
}
