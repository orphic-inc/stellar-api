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

// ─── Source URL resolution ────────────────────────────────────────────────────

async function resolveSourceUrls(
  items: Array<{ id: number; targetType: ReportTargetType; targetId: number }>
): Promise<Map<number, string | null>> {
  const urlMap = new Map<number, string | null>();

  const byType = new Map<
    ReportTargetType,
    Array<{ reportId: number; targetId: number }>
  >();
  for (const r of items) {
    const existing = byType.get(r.targetType) ?? [];
    existing.push({ reportId: r.id, targetId: r.targetId });
    byType.set(r.targetType, existing);
  }

  for (const [type, entries] of byType) {
    const targetIds = entries.map((e) => e.targetId);

    switch (type) {
      case 'User': {
        const users = await prisma.user.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, username: true }
        });
        const usernameById = new Map(users.map((u) => [u.id, u.username]));
        for (const { reportId, targetId } of entries) {
          const username = usernameById.get(targetId);
          urlMap.set(reportId, username ? `/private/user/${username}` : null);
        }
        break;
      }
      case 'Release': {
        const releases = await prisma.release.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, communityId: true }
        });
        const byId = new Map(releases.map((r) => [r.id, r]));
        for (const { reportId, targetId } of entries) {
          const rel = byId.get(targetId);
          urlMap.set(
            reportId,
            rel?.communityId
              ? `/private/communities/${rel.communityId}/releases/${targetId}`
              : null
          );
        }
        break;
      }
      case 'Contribution': {
        const contribs = await prisma.contribution.findMany({
          where: { id: { in: targetIds } },
          select: {
            id: true,
            releaseId: true,
            release: { select: { communityId: true } }
          }
        });
        const byId = new Map(contribs.map((c) => [c.id, c]));
        for (const { reportId, targetId } of entries) {
          const c = byId.get(targetId);
          urlMap.set(
            reportId,
            c?.release?.communityId
              ? `/private/communities/${c.release.communityId}/releases/${c.releaseId}`
              : null
          );
        }
        break;
      }
      case 'ForumTopic': {
        const topics = await prisma.forumTopic.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, forumId: true }
        });
        const byId = new Map(topics.map((t) => [t.id, t]));
        for (const { reportId, targetId } of entries) {
          const t = byId.get(targetId);
          urlMap.set(
            reportId,
            t ? `/private/forums/${t.forumId}/topics/${targetId}` : null
          );
        }
        break;
      }
      case 'ForumPost': {
        const posts = await prisma.forumPost.findMany({
          where: { id: { in: targetIds } },
          select: {
            id: true,
            forumTopicId: true,
            forumTopic: { select: { forumId: true } }
          }
        });
        const byId = new Map(posts.map((p) => [p.id, p]));
        for (const { reportId, targetId } of entries) {
          const p = byId.get(targetId);
          urlMap.set(
            reportId,
            p
              ? `/private/forums/${p.forumTopic.forumId}/topics/${p.forumTopicId}`
              : null
          );
        }
        break;
      }
      case 'Collage': {
        for (const { reportId, targetId } of entries) {
          urlMap.set(reportId, `/private/collages/${targetId}`);
        }
        break;
      }
      case 'Artist': {
        for (const { reportId, targetId } of entries) {
          urlMap.set(reportId, `/private/artists/${targetId}`);
        }
        break;
      }
      case 'Comment': {
        const comments = await prisma.comment.findMany({
          where: { id: { in: targetIds } },
          select: {
            id: true,
            page: true,
            artistId: true,
            releaseId: true,
            release: { select: { communityId: true } },
            collageId: true,
            requestId: true,
            communityId: true,
            contributionId: true,
            contribution: {
              select: {
                releaseId: true,
                release: { select: { communityId: true } }
              }
            }
          }
        });
        const byId = new Map(comments.map((c) => [c.id, c]));
        for (const { reportId, targetId } of entries) {
          const c = byId.get(targetId);
          if (!c) {
            urlMap.set(reportId, null);
            break;
          }
          let url: string | null = null;
          if (c.page === 'artist' && c.artistId) {
            url = `/private/artists/${c.artistId}`;
          } else if (
            c.page === 'release' &&
            c.releaseId &&
            c.release?.communityId
          ) {
            url = `/private/communities/${c.release.communityId}/releases/${c.releaseId}`;
          } else if (c.page === 'collages' && c.collageId) {
            url = `/private/collages/${c.collageId}`;
          } else if (c.page === 'requests' && c.requestId) {
            url = `/private/requests/${c.requestId}`;
          } else if (
            c.page === 'contributions' &&
            c.contributionId &&
            c.contribution?.release?.communityId
          ) {
            url = `/private/communities/${c.contribution.release.communityId}/releases/${c.contribution.releaseId}`;
          } else if (c.page === 'communities' && c.communityId) {
            url = `/private/communities/${c.communityId}`;
          }
          urlMap.set(reportId, url);
        }
        break;
      }
      default: {
        for (const { reportId } of entries) {
          urlMap.set(reportId, null);
        }
      }
    }
  }

  return urlMap;
}

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

export async function getReport(
  id: number,
  requesterId: number,
  isStaff: boolean
) {
  const report = await prisma.report.findUnique({
    where: { id },
    include: reportInclude
  });
  if (!report) return { ok: false as const, reason: 'not_found' };
  if (!isStaff && report.reporterId !== requesterId) {
    return { ok: false as const, reason: 'forbidden' };
  }
  const urlMap = await resolveSourceUrls([
    { id: report.id, targetType: report.targetType, targetId: report.targetId }
  ]);
  return {
    ok: true as const,
    report: { ...report, sourceUrl: urlMap.get(report.id) ?? null }
  };
}

export async function claimReport(id: number, staffUserId: number) {
  const report = await prisma.report.findUnique({
    where: { id },
    select: { status: true, claimedById: true }
  });
  if (!report) return { ok: false as const, reason: 'not_found' };
  if (report.status === 'Resolved')
    return { ok: false as const, reason: 'resolved' };
  if (report.claimedById !== null && report.claimedById !== staffUserId) {
    return { ok: false as const, reason: 'already_claimed' };
  }

  await prisma.report.update({
    where: { id },
    data: { status: 'Claimed', claimedById: staffUserId, claimedAt: new Date() }
  });
  await audit(prisma, staffUserId, 'report.claim', 'Report', id);
  return { ok: true as const };
}

export async function unclaimReport(id: number, staffUserId: number) {
  const report = await prisma.report.findUnique({
    where: { id },
    select: { status: true, claimedById: true }
  });
  if (!report) return { ok: false as const, reason: 'not_found' };
  if (report.status !== 'Claimed')
    return { ok: false as const, reason: 'not_claimed' };
  if (report.claimedById !== staffUserId)
    return { ok: false as const, reason: 'forbidden' };

  await prisma.report.update({
    where: { id },
    data: { status: 'Open', claimedById: null, claimedAt: null }
  });
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
          `View your report: /private/reports/${id}`
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

export async function listMyReports(userId: number, page: number) {
  const where = { reporterId: userId };
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
    }))
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
        orderBy: { _count: { id: 'desc' } },
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
