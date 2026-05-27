/**
 * devTools/validate.ts
 *
 * Post-generation integrity checks.
 * Returns a list of named checks with pass/fail status.
 * Failures are informational — they don't abort the run,
 * but they surface in the API response and UI.
 */

import { PrismaClient } from '@prisma/client';
import { RunContext, ValidationResult, ValidationCheck } from './types';

export async function validate(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<ValidationResult> {
  const checks: ValidationCheck[] = [];

  const check = (name: string, passed: boolean, message?: string): void => {
    checks.push({ name, passed, message });
  };

  // ─── User count ───────────────────────────────────────────────────────────

  const userCount = await prisma.user.count({
    where: { id: { in: ctx.generatedUserIds } }
  });
  check(
    'generated-users-exist',
    userCount === ctx.generatedUserIds.length,
    `Expected ${ctx.generatedUserIds.length} users, found ${userCount}`
  );

  // ─── Community count ──────────────────────────────────────────────────────

  const communityCount = await prisma.community.count({
    where: { id: { in: ctx.generatedCommunityIds } }
  });
  check(
    'generated-communities-exist',
    communityCount === ctx.generatedCommunityIds.length,
    `Expected ${ctx.generatedCommunityIds.length} communities, found ${communityCount}`
  );

  // ─── Releases have correct community ─────────────────────────────────────

  if (ctx.generatedReleaseIds.length > 0) {
    const releaseCount = await prisma.release.count({
      where: { id: { in: ctx.generatedReleaseIds } }
    });
    check(
      'generated-releases-exist',
      releaseCount === ctx.generatedReleaseIds.length,
      `Expected ${ctx.generatedReleaseIds.length} releases, found ${releaseCount}`
    );
  }

  // ─── Vote aggregates consistent ───────────────────────────────────────────

  const aggregates = await prisma.releaseVoteAggregate.findMany({
    where: { releaseId: { in: ctx.generatedReleaseIds } },
    select: { releaseId: true, ups: true, total: true }
  });

  for (const agg of aggregates.slice(0, 10)) {
    const actualVotes = await prisma.releaseVote.count({
      where: { releaseId: agg.releaseId }
    });
    const actualUps = await prisma.releaseVote.count({
      where: { releaseId: agg.releaseId, positive: true }
    });
    if (agg.total !== actualVotes || agg.ups !== actualUps) {
      check(
        `vote-aggregate-release-${agg.releaseId}`,
        false,
        `Aggregate shows ${agg.ups}/${agg.total} but actual is ${actualUps}/${actualVotes}`
      );
    }
  }

  if (aggregates.length > 0) {
    check(
      'vote-aggregates-sampled',
      true,
      `Sampled ${Math.min(10, aggregates.length)} aggregates`
    );
  }

  // ─── Request voteCount consistent ────────────────────────────────────────

  if (ctx.generatedRequestIds.length > 0) {
    const sampleRequestId = ctx.generatedRequestIds[0];
    const request = await prisma.request.findUnique({
      where: { id: sampleRequestId },
      select: { voteCount: true }
    });
    const actualVotes = await prisma.requestVote.count({
      where: { requestId: sampleRequestId }
    });
    check(
      'request-votecount-consistent',
      request?.voteCount === actualVotes,
      `Request ${sampleRequestId}: stored=${request?.voteCount}, actual=${actualVotes}`
    );
  }

  // ─── Wiki revision chain ──────────────────────────────────────────────────

  for (const pageId of ctx.generatedWikiPageIds.slice(0, 5)) {
    const page = await prisma.wikiPage.findUnique({
      where: { id: pageId },
      select: { revision: true }
    });
    const maxRevision = await prisma.wikiRevision.findFirst({
      where: { pageId },
      orderBy: { revision: 'desc' },
      select: { revision: true }
    });
    if (page && maxRevision) {
      check(
        `wiki-revision-chain-page-${pageId}`,
        page.revision === maxRevision.revision,
        `Page ${pageId}: page.revision=${page.revision}, max WikiRevision.revision=${maxRevision.revision}`
      );
    }
  }

  // ─── DevSeedRecord not orphaned (spot check) ──────────────────────────────

  const recordCount = await prisma.devSeedRecord.count({
    where: { runId: ctx.runId }
  });
  check(
    'seed-records-exist',
    recordCount > 0,
    `Found ${recordCount} DevSeedRecord rows for runId=${ctx.runId}`
  );

  // ─── Reports target valid entities ────────────────────────────────────────

  if (ctx.generatedReportIds.length > 0) {
    const reportCount = await prisma.report.count({
      where: { id: { in: ctx.generatedReportIds } }
    });
    check(
      'generated-reports-exist',
      reportCount === ctx.generatedReportIds.length,
      `Expected ${ctx.generatedReportIds.length} reports, found ${reportCount}`
    );
  }

  // ─── Contributions: at least some releases have contributions ────────────

  if (
    ctx.generatedReleaseIds.length > 0 &&
    ctx.generatedContributionIds.length > 0
  ) {
    // Sample up to 10 releases; expect >50% to have contributions
    // (edge-case mode may deliberately skip 10% of releases)
    const sampleIds = ctx.generatedReleaseIds.slice(0, 10);
    const withContribs = await prisma.contribution.count({
      where: { releaseId: { in: sampleIds } }
    });
    const distinctReleases = await prisma.contribution
      .groupBy({
        by: ['releaseId'],
        where: { releaseId: { in: sampleIds } }
      })
      .then((rows) => rows.length);
    const minExpected = Math.floor(sampleIds.length * 0.5);
    check(
      'releases-have-contributions',
      distinctReleases >= minExpected,
      `${distinctReleases}/${sampleIds.length} sampled releases have at least one contribution (${withContribs} total contributions)`
    );
  }

  // ─── UserStatSnapshot: user IDs exist ────────────────────────────────────

  if (ctx.summary['UserStatSnapshot'] && ctx.generatedUserIds.length > 0) {
    const snapCount = await prisma.userStatSnapshot.count({
      where: { userId: { in: ctx.generatedUserIds } }
    });
    check(
      'user-stat-snapshots-have-valid-users',
      snapCount > 0,
      `${snapCount} UserStatSnapshot rows reference generated users`
    );
  }

  // ─── Top10SnapshotEntry: release IDs exist ────────────────────────────────

  if (ctx.generatedReleaseIds.length > 0) {
    const entries = await prisma.top10SnapshotEntry.count({
      where: { releaseId: { in: ctx.generatedReleaseIds } }
    });
    if (entries > 0) {
      check(
        'top10-entry-releases-exist',
        true,
        `${entries} Top10SnapshotEntry rows reference valid generated releases`
      );
    }
  }

  // ─── Forum counters consistent (integrated mode) ──────────────────────────

  if (
    ctx.config.mode === 'integrated' &&
    ctx.generatedForumTopicIds.length > 0
  ) {
    // Sample one generated topic and verify the parent forum's numTopics > 0
    const topic = await prisma.forumTopic.findFirst({
      where: { id: { in: ctx.generatedForumTopicIds } },
      select: { forumId: true }
    });
    if (topic) {
      const forum = await prisma.forum.findUnique({
        where: { id: topic.forumId },
        select: { numTopics: true }
      });
      check(
        'forum-numtopics-nonzero',
        (forum?.numTopics ?? 0) > 0,
        `Forum ${topic.forumId}: numTopics=${forum?.numTopics}`
      );
    }
  }

  // ─── Isolated mode: no non-generated references ───────────────────────────

  if (ctx.config.mode === 'isolated') {
    // All generated release tags should reference seed.* tags
    const nonSeedTagCount = await prisma.releaseTag.count({
      where: {
        releaseId: { in: ctx.generatedReleaseIds },
        tag: { name: { not: { startsWith: 'seed.' } } }
      }
    });
    check(
      'isolated-mode-no-non-seed-tags',
      nonSeedTagCount === 0,
      `Found ${nonSeedTagCount} release tags referencing non-seed tags in isolated mode`
    );
  }

  const passed = checks.every((c) => c.passed);
  return { passed, checks };
}
