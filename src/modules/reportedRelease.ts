import { CommentPage, ReportStatus, ReportTargetType } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Which of these releases an `Open` or `Claimed` report concerns (ADR-0055 §3,
 * #905). A report concerns a release when it targets the release, one of its
 * contributions, or a comment in the thread of either.
 *
 * This is the whole of the report-scoped read: a `reports_manage` holder may
 * open the page of a release in this set, and the staff queue links to it, so
 * the link appears exactly when the page will open. It holds no permission
 * check, as `communityAccess.ts` holds none; each caller checks
 * `reports_manage` itself.
 *
 * A report names its target by type and id, with no relation to follow, so
 * this is a lookup rather than a `where` fragment. Each query starts from the
 * open reports, which stay few, rather than from a release's comments, which
 * need not.
 */
export async function releasesUnderOpenReport(
  releaseIds: number[]
): Promise<Set<number>> {
  if (releaseIds.length === 0) return new Set();

  const openTargets = async (
    targetType: ReportTargetType,
    targetId?: { in: number[] }
  ) =>
    (
      await prisma.report.findMany({
        where: {
          status: { in: [ReportStatus.Open, ReportStatus.Claimed] },
          targetType,
          targetId
        },
        select: { targetId: true }
      })
    ).map((r) => r.targetId);

  const inReleases = { in: releaseIds };
  const [releases, contributionIds, commentIds] = await Promise.all([
    openTargets(ReportTargetType.Release, inReleases),
    openTargets(ReportTargetType.Contribution),
    openTargets(ReportTargetType.Comment)
  ]);

  const [contributions, comments] = await Promise.all([
    contributionIds.length === 0
      ? []
      : prisma.contribution.findMany({
          where: { id: { in: contributionIds }, releaseId: inReleases },
          select: { releaseId: true }
        }),
    commentIds.length === 0
      ? []
      : prisma.comment.findMany({
          where: {
            id: { in: commentIds },
            OR: [
              { page: CommentPage.release, releaseId: inReleases },
              {
                page: CommentPage.contributions,
                contribution: { releaseId: inReleases }
              }
            ]
          },
          select: {
            releaseId: true,
            contribution: { select: { releaseId: true } }
          }
        })
  ]);

  const concerned = new Set(releases);
  for (const c of contributions) concerned.add(c.releaseId);
  for (const c of comments) {
    const releaseId = c.releaseId ?? c.contribution?.releaseId;
    if (releaseId != null) concerned.add(releaseId);
  }
  return concerned;
}
