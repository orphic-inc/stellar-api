import { ReleaseHistoryAction, ReleaseTagVoteDirection } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { ReleaseSnapshot } from './releaseWorkbench/snapshot';
import type { ReleaseTagView } from './releaseWorkbench/types';

/**
 * The tag helpers every release surface needs, in one place.
 *
 * These three were defined privately in four modules — `releaseBrowse`,
 * `releaseLifecycle`, `releaseWorkbench/load` and `releaseWorkbench/tags` —
 * because each surface that renders or writes a release's tags needs the same
 * derivation, and the workbench's split-by-concern layout gave no obvious shared
 * home. Every copy was textually identical, which is precisely the drift risk:
 * the +1/-1 vote seeding below is a scoring convention, and four copies of a
 * convention is four chances to change only some of them.
 *
 * This sits in `modules/` beside the other `release*` files rather than inside
 * `releaseWorkbench/`, because `releaseBrowse` is not a workbench surface and
 * should not have to import from one. `releaseLifecycle` already reaches into
 * `releaseWorkbench/snapshot`, so that direction is the established one.
 */

/** Release tags as a plain, name-sorted list — the browse/detail shape. */
export const buildPlainTags = (
  releaseTags: Array<{ tag: { id: number; name: string; occurrences: number } }>
) =>
  releaseTags
    .map((releaseTag) => releaseTag.tag)
    .sort((a, b) => a.name.localeCompare(b.name));

/**
 * The voted tag shape the workbench renders.
 *
 * Votes are stored seeded at +1/-1 so a freshly added tag outranks an unvoted
 * one; the seed is subtracted back out here, which is why both counts carry a
 * `Math.max(0, … - 1)` while `score` keeps the raw difference.
 */
export const buildReleaseTagPayload = (
  tags: Array<{ id: number; name: string; occurrences: number }>,
  releaseTags: Array<{
    id: number;
    tagId: number;
    positiveVotes: number;
    negativeVotes: number;
    createdAt: Date;
    user: { id: number; username: string } | null;
    votes: Array<{ direction: ReleaseTagVoteDirection }>;
  }>
): ReleaseTagView[] => {
  const byTagId = new Map(
    releaseTags.map((releaseTag) => [releaseTag.tagId, releaseTag])
  );

  return tags
    .map((tag) => {
      const releaseTag = byTagId.get(tag.id);
      const positiveVotes = releaseTag?.positiveVotes ?? 1;
      const negativeVotes = releaseTag?.negativeVotes ?? 1;

      return {
        id: releaseTag?.id ?? tag.id,
        tagId: tag.id,
        name: tag.name,
        occurrences: tag.occurrences,
        score: positiveVotes - negativeVotes,
        positiveVotes: Math.max(0, positiveVotes - 1),
        negativeVotes: Math.max(0, negativeVotes - 1),
        addedBy: releaseTag?.user ?? null,
        createdAt: releaseTag?.createdAt ?? null,
        myVotes: {
          up:
            releaseTag?.votes.some(
              (vote) => vote.direction === ReleaseTagVoteDirection.up
            ) ?? false,
          down:
            releaseTag?.votes.some(
              (vote) => vote.direction === ReleaseTagVoteDirection.down
            ) ?? false
        }
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
};

/**
 * Create a release tag already carrying its author's up-vote, optionally
 * recording the history entry.
 *
 * `tx` is typed as the narrow slice actually used rather than
 * `Prisma.TransactionClient`, because the two call sites pass different things —
 * an interactive transaction from the workbench, the plain client from the
 * lifecycle create path — and both satisfy this.
 */
export const attachTagWithVotes = async (
  tx: Pick<typeof prisma, 'releaseTag' | 'releaseTagVote' | 'releaseHistory'>,
  releaseId: number,
  actorId: number,
  tag: { id: number; name: string },
  writeHistory: boolean,
  snapshot?: ReleaseSnapshot
): Promise<void> => {
  const releaseTag = await tx.releaseTag.create({
    data: {
      releaseId,
      tagId: tag.id,
      userId: actorId,
      positiveVotes: 3,
      negativeVotes: 1
    }
  });
  await tx.releaseTagVote.create({
    data: {
      releaseTagId: releaseTag.id,
      userId: actorId,
      direction: ReleaseTagVoteDirection.up
    }
  });
  if (writeHistory) {
    await tx.releaseHistory.create({
      data: {
        releaseId,
        actorId,
        action: ReleaseHistoryAction.tag_added,
        summary: `Tag "${tag.name}" added`,
        changedFields: ['tags'],
        before: { tagId: tag.id, name: tag.name, score: 0 } as never,
        after: { tagId: tag.id, name: tag.name, score: 2 } as never,
        ...(snapshot !== undefined && { snapshot: snapshot as never })
      }
    });
  }
};
