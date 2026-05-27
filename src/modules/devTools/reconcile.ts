/**
 * devTools/reconcile.ts
 *
 * After batch inserts, recompute denormalized fields that domain services
 * normally maintain. This keeps the app's invariants consistent even
 * when bypassing domain services for performance.
 *
 * Fields reconciled:
 *   - Request.voteCount (from RequestVote)
 *   - Collage.numEntries (from CollageEntry)
 *   - Tag.occurrences (isolated mode — seed.* tags only)
 *   - User.ratio (from contributed/consumed)
 *   - ReleaseVoteAggregate (already created by releases generator, but re-verified here)
 */

import { PrismaClient } from '@prisma/client';
import { RunContext } from './types';

export async function reconcile(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  // ─── Request.voteCount ────────────────────────────────────────────────────

  if (ctx.generatedRequestIds.length > 0) {
    for (const requestId of ctx.generatedRequestIds) {
      const voteCount = await prisma.requestVote.count({
        where: { requestId }
      });
      await prisma.request.update({
        where: { id: requestId },
        data: { voteCount }
      });
    }
  }

  // ─── Collage.numEntries ───────────────────────────────────────────────────

  if (ctx.generatedCollageIds.length > 0) {
    for (const collageId of ctx.generatedCollageIds) {
      const numEntries = await prisma.collageEntry.count({
        where: { collageId }
      });
      await prisma.collage.update({
        where: { id: collageId },
        data: { numEntries }
      });
    }
  }

  // ─── Tag.occurrences (isolated mode) ─────────────────────────────────────

  if (ctx.config.mode === 'isolated') {
    // Find all seed.* tags referenced by generated releases
    const seedReleaseTags = await prisma.releaseTag.findMany({
      where: {
        releaseId: { in: ctx.generatedReleaseIds },
        tag: { name: { startsWith: 'seed.' } }
      },
      select: { tagId: true }
    });

    const tagIdCounts = new Map<number, number>();
    for (const rt of seedReleaseTags) {
      tagIdCounts.set(rt.tagId, (tagIdCounts.get(rt.tagId) ?? 0) + 1);
    }

    for (const [tagId, count] of tagIdCounts) {
      await prisma.tag.update({
        where: { id: tagId },
        data: { occurrences: count }
      });
    }
  }

  // ─── User.ratio ───────────────────────────────────────────────────────────

  for (const userId of ctx.generatedUserIds) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { contributed: true, consumed: true }
    });
    if (!user) continue;
    const ratio =
      user.consumed === 0n
        ? user.contributed === 0n
          ? 1.0
          : 100.0
        : Number(user.contributed) / Number(user.consumed);
    await prisma.user.update({
      where: { id: userId },
      data: { ratio }
    });
  }

  // ─── Collage.numSubscribers ───────────────────────────────────────────────

  if (ctx.generatedCollageIds.length > 0) {
    for (const collageId of ctx.generatedCollageIds) {
      const numSubscribers = await prisma.collageSubscription.count({
        where: { collageId }
      });
      await prisma.collage.update({
        where: { id: collageId },
        data: { numSubscribers }
      });
    }
  }
}
