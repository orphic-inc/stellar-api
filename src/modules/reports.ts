import { prisma } from '../lib/prisma';
import {
  Prisma,
  type ReportStatus,
  type ReportTargetType
} from '@prisma/client';
import type { ReportResolutionAction } from '../schemas/reports';

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
}>;
export type ReportNoteRow = Prisma.ReportNoteGetPayload<{
  include: { author: { select: { id: true; username: true; avatar: true } } };
}>;
export type ReportSummary = {
  id: number;
  targetType: ReportTargetType;
  targetId: number;
  category: string;
  status: ReportStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
};

export async function fileReport(
  reporterId: number,
  targetType: ReportTargetType,
  targetId: number,
  category: string,
  reason: string,
  evidence?: string
) {
  const report = await prisma.report.create({
    data: { reporterId, targetType, targetId, category, reason, evidence },
    include: reportInclude
  });
  return { ok: true as const, report };
}

export async function listReports(opts: {
  page: number;
  status: ReportStatus | 'all';
  targetType: ReportTargetType | 'all';
  claimedByMe: boolean;
  staffUserId: number;
}) {
  const { page, status, targetType, claimedByMe, staffUserId } = opts;

  const where: Prisma.ReportWhereInput = {};
  if (status !== 'all') where.status = status;
  if (targetType !== 'all') where.targetType = targetType;
  if (claimedByMe) where.claimedById = staffUserId;

  const [total, reports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: reportInclude
    })
  ]);

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
  return { ok: true as const, report };
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
  return { ok: true as const };
}

export async function resolveReport(
  id: number,
  staffUserId: number,
  resolution: string,
  resolutionAction: ReportResolutionAction
) {
  const report = await prisma.report.findUnique({
    where: { id },
    select: { status: true }
  });
  if (!report) return { ok: false as const, reason: 'not_found' };
  if (report.status === 'Resolved')
    return { ok: false as const, reason: 'already_resolved' };

  await prisma.report.update({
    where: { id },
    data: {
      status: 'Resolved',
      resolvedById: staffUserId,
      resolvedAt: new Date(),
      resolution,
      resolutionAction
    }
  });
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
  const [total, reports] = await Promise.all([
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
        status: true,
        createdAt: true,
        resolvedAt: true,
        resolution: true
      }
    })
  ]);
  return { total, page, pageSize: PAGE_SIZE, reports };
}

export async function getReportCounts() {
  const [open, claimed] = await Promise.all([
    prisma.report.count({ where: { status: 'Open' } }),
    prisma.report.count({ where: { status: 'Claimed' } })
  ]);
  return { open, claimed };
}
