/**
 * devTools/generators/reports.ts
 *
 * Generates Report and ReportNote rows covering all ReportTargetType variants.
 * Resolution actions are coherent with the report subject.
 *
 * Coverage:
 *   Models: Report, ReportNote
 *   Edge cases: open, claimed, resolved reports; all target types;
 *               multiple staff notes; non-reversible actions (user disabled)
 */

import {
  PrismaClient,
  ReportStatus,
  ReportTargetType,
  ReportResolutionAction,
  ReleaseReportCategory
} from '@prisma/client';
import { RunContext } from '../types';
import { pick, randInt, randBool, daysAgo, SeedContext } from '../seedRandom';
import { makeReportReason } from '../contentFactory';
import { trackCreate } from '../tracking';

// Statuses: Open 40%, Claimed 30%, Resolved 30%
const STATUSES: ReportStatus[] = ['Open', 'Claimed', 'Resolved'];
const STATUS_WEIGHTS = [40, 30, 30];

function pickStatus(rng: SeedContext): ReportStatus {
  const r = rng.next() * 100;
  let acc = 0;
  for (let i = 0; i < STATUSES.length; i++) {
    acc += STATUS_WEIGHTS[i];
    if (r < acc) return STATUSES[i];
  }
  return 'Open';
}

const RESOLUTION_ACTIONS: ReportResolutionAction[] = [
  'Dismissed',
  'ContentRemoved',
  'UserWarned',
  'UserDisabled',
  'MetadataFixed',
  'MarkedDuplicate',
  'Other'
];

const RELEASE_CATEGORIES: ReleaseReportCategory[] = [
  'Dupe',
  'Trump',
  'Transcode',
  'BadFileNames',
  'LowBitrate',
  'Other'
];

export async function generateReports(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  const { config, runId } = ctx;
  const rng = new SeedContext(config.seed).fork('reports');

  if (ctx.generatedUserIds.length < 2) return;

  const users = ctx.generatedUserIds;
  const staff =
    ctx.generatedStaffUserIds.length > 0
      ? ctx.generatedStaffUserIds
      : [users[0]];
  const targetCount = Math.max(
    1,
    Math.round(config.counts.reports * config.scale)
  );

  // Build a map of target type → available IDs
  const targetMap: Partial<Record<ReportTargetType, number[]>> = {
    User: users,
    Release: ctx.generatedReleaseIds,
    Artist: ctx.generatedArtistIds,
    Contribution: ctx.generatedContributionIds,
    Comment: ctx.generatedCommentIds,
    Collage: ctx.generatedCollageIds
    // Request is not a ReportTargetType; ForumTopic/ForumPost require integrated mode
  };

  const availableTypes = (Object.keys(targetMap) as ReportTargetType[]).filter(
    (t) => (targetMap[t]?.length ?? 0) > 0
  );

  if (availableTypes.length === 0) return;

  const createdReportIds: number[] = [];

  for (let i = 0; i < targetCount; i++) {
    const reporterId = pick(users, rng);
    const targetType = pick(availableTypes, rng);
    const targetIds = targetMap[targetType]!;
    const targetId = pick(targetIds, rng);
    const status = pickStatus(rng);
    const createdAt = daysAgo(0, 2 * 365, rng);

    let claimedById: number | null = null;
    let claimedAt: Date | null = null;
    let resolvedById: number | null = null;
    let resolvedAt: Date | null = null;
    let resolution: string | null = null;
    let resolutionAction: ReportResolutionAction | null = null;

    if (status === 'Claimed' || status === 'Resolved') {
      claimedById = pick(staff, rng);
      claimedAt = new Date(
        createdAt.getTime() + randInt(1, 48, rng) * 60 * 60 * 1000
      );
    }

    if (status === 'Resolved') {
      resolvedById = pick(staff, rng);
      resolvedAt = new Date(
        claimedAt!.getTime() + randInt(1, 72, rng) * 60 * 60 * 1000
      );
      resolutionAction = pick(RESOLUTION_ACTIONS, rng);
      resolution = `Reviewed and ${resolutionAction.toLowerCase()} — seed-generated resolution.`;
    }

    const releaseCategory =
      targetType === 'Release' || targetType === 'Contribution'
        ? pick(RELEASE_CATEGORIES, rng)
        : null;

    const report = await prisma.report.create({
      data: {
        reporterId,
        targetType,
        targetId,
        category:
          targetType === 'Release' ? 'release' : targetType.toLowerCase(),
        releaseCategory,
        reason: makeReportReason(rng).substring(0, 2000),
        evidence: randBool(0.3, rng)
          ? `Evidence: see contribution at https://seed.invalid/c/${targetId}`
          : null,
        status,
        claimedById,
        claimedAt,
        resolvedById,
        resolvedAt,
        resolution,
        resolutionAction,
        createdAt,
        updatedAt: resolvedAt ?? claimedAt ?? createdAt
      }
    });
    createdReportIds.push(report.id);
    await trackCreate(
      prisma as Parameters<typeof trackCreate>[0],
      runId,
      'Report',
      { id: report.id }
    );

    // ReportNotes for claimed/resolved reports
    if (status !== 'Open' && config.includeModerationData) {
      const noteCount = randInt(1, 3, rng);
      for (let n = 0; n < noteCount; n++) {
        const noteAuthor = pick(staff, rng);
        const note = await prisma.reportNote.create({
          data: {
            reportId: report.id,
            authorId: noteAuthor,
            body: `Staff note: ${makeReportReason(rng).substring(0, 400)}`,
            createdAt: new Date(
              (claimedAt?.getTime() ?? createdAt.getTime()) +
                n * 2 * 60 * 60 * 1000
            )
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'ReportNote',
          { id: note.id }
        );
      }
    }
  }

  ctx.generatedReportIds = createdReportIds;
  ctx.summary['Report'] = createdReportIds.length;
}
