import {
  Prisma,
  ReleaseHistoryAction,
  ReleaseTagVoteDirection
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { translatePrismaError } from '../../lib/prismaErrors';
import { assertUsableTagName, resolveTagName } from '../tag';
import { loadReleaseWorkbenchAuthority } from './authority';
import { getReleaseWorkbenchView } from './load';
import { snapshotRelease, type ReleaseSnapshot } from './snapshot';
import type {
  ReleaseTagView,
  ReleaseWorkbenchRef,
  ReleaseWorkbenchView
} from './types';
import { attachTagWithVotes, buildReleaseTagPayload } from '../releaseTags';

export const addReleaseWorkbenchTag = async (
  ref: ReleaseWorkbenchRef,
  input: { name: string }
): Promise<ReleaseWorkbenchView> => {
  await loadReleaseWorkbenchAuthority(ref);
  const name = await resolveTagName(input.name);
  assertUsableTagName(name);

  const release = await prisma.release.findFirst({
    where: { id: ref.releaseId, communityId: ref.communityId },
    select: {
      id: true,
      releaseTags: { where: { tag: { name } }, select: { id: true } }
    }
  });
  if (!release) {
    throw new AppError(404, 'Release not found');
  }
  if (release.releaseTags.length > 0) {
    throw new AppError(409, 'Release already has this tag');
  }

  await prisma.$transaction(async (tx) => {
    const tag = await tx.tag.upsert({
      where: { name },
      create: { name, occurrences: 1 },
      update: { occurrences: { increment: 1 } }
    });
    const currentRelease = await tx.release.findUniqueOrThrow({
      where: { id: ref.releaseId },
      include: { releaseTags: { include: { tag: true } } }
    });
    const postAddSnapshot: ReleaseSnapshot = {
      ...snapshotRelease(currentRelease),
      tagIds: [
        ...currentRelease.releaseTags.map((rt) => rt.tag.id),
        tag.id
      ].sort((a, b) => a - b),
      tagNames: [
        ...currentRelease.releaseTags.map((rt) => rt.tag.name),
        tag.name
      ].sort()
    };
    await attachTagWithVotes(
      tx,
      ref.releaseId,
      ref.actorId,
      tag,
      true,
      postAddSnapshot
    );
  });

  return getReleaseWorkbenchView(ref);
};

export const voteOnReleaseWorkbenchTag = async (
  ref: ReleaseWorkbenchRef,
  input: { tagId: number; direction: 'up' | 'down' }
): Promise<ReleaseTagView> => {
  await loadReleaseWorkbenchAuthority(ref);

  const releaseTag = await prisma.releaseTag.findFirst({
    where: {
      releaseId: ref.releaseId,
      tagId: input.tagId,
      release: { communityId: ref.communityId }
    },
    select: { id: true }
  });
  if (!releaseTag) {
    throw new AppError(404, 'Release tag not found');
  }

  const direction = input.direction as ReleaseTagVoteDirection;
  const oppositeDirection =
    direction === ReleaseTagVoteDirection.up
      ? ReleaseTagVoteDirection.down
      : ReleaseTagVoteDirection.up;

  const [existingVote, oppositeVote] = await Promise.all([
    prisma.releaseTagVote.findUnique({
      where: {
        releaseTagId_userId_direction: {
          releaseTagId: releaseTag.id,
          userId: ref.actorId,
          direction
        }
      }
    }),
    prisma.releaseTagVote.findUnique({
      where: {
        releaseTagId_userId_direction: {
          releaseTagId: releaseTag.id,
          userId: ref.actorId,
          direction: oppositeDirection
        }
      }
    })
  ]);

  if (!existingVote) {
    await castVote(releaseTag.id, ref.actorId, direction, oppositeVote?.id);
  }

  return readVotedTag(releaseTag.id, ref.actorId);
};

/** The release tag as the voter now sees it, with their own votes. */
const readVotedTag = async (
  releaseTagId: number,
  actorId: number
): Promise<ReleaseTagView> => {
  const updated = await prisma.releaseTag.findUniqueOrThrow({
    where: { id: releaseTagId },
    include: {
      tag: true,
      user: { select: { id: true, username: true } },
      votes: {
        where: { userId: actorId },
        select: { direction: true }
      }
    }
  });

  return buildReleaseTagPayload(
    [
      {
        id: updated.tag.id,
        name: updated.tag.name,
        occurrences: updated.tag.occurrences
      }
    ],
    [
      {
        id: updated.id,
        tagId: updated.tag.id,
        positiveVotes: updated.positiveVotes,
        negativeVotes: updated.negativeVotes,
        createdAt: updated.createdAt,
        user: updated.user ?? null,
        votes: updated.votes
      }
    ]
  )[0];
};

/**
 * Record a vote, replacing the member's opposite vote if they had one.
 *
 * The existing votes were read before this, so two concurrent identical votes
 * both reach the create (#596). The loser's P2002 means the vote it wanted is
 * already recorded, so it is the no-op an already-voted caller gets. A release
 * tag removed in between cascades its votes away: that answers as a missing
 * tag.
 */
const castVote = async (
  releaseTagId: number,
  userId: number,
  direction: ReleaseTagVoteDirection,
  oppositeVoteId: number | undefined
) => {
  const up = direction === ReleaseTagVoteDirection.up;
  const hadOpposite = oppositeVoteId !== undefined;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.releaseTagVote.create({
        data: { releaseTagId, userId, direction }
      });
      if (hadOpposite) {
        await tx.releaseTagVote.delete({ where: { id: oppositeVoteId } });
      }
      await tx.releaseTag.update({
        where: { id: releaseTagId },
        data: up
          ? {
              positiveVotes: { increment: 2 },
              ...(hadOpposite ? { negativeVotes: { decrement: 1 } } : {})
            }
          : {
              negativeVotes: { increment: 1 },
              ...(hadOpposite ? { positiveVotes: { decrement: 1 } } : {})
            }
      });
    });
  } catch (err) {
    if (hasPrismaCode(err, 'P2002')) return;
    translatePrismaError(err, {
      P2003: [404, 'Release tag not found'],
      P2025: [404, 'Release tag not found']
    });
  }
};

const hasPrismaCode = (err: unknown, code: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

export const removeReleaseWorkbenchTag = async (
  ref: ReleaseWorkbenchRef,
  input: { tagId: number }
): Promise<ReleaseWorkbenchView> => {
  const release = await prisma.release.findFirst({
    where: {
      id: ref.releaseId,
      communityId: ref.communityId,
      releaseTags: { some: { tagId: input.tagId } }
    },
    select: { id: true }
  });
  if (!release) {
    throw new AppError(404, 'Release or tag not found');
  }

  const authority = await loadReleaseWorkbenchAuthority(ref, {
    requireCommunityAccess: false
  });
  if (!authority.canManageTags) {
    throw new AppError(403, 'Permission denied');
  }

  const tag = await prisma.tag.findUnique({
    where: { id: input.tagId },
    select: { name: true }
  });

  await removeTagWithHistory(ref, input.tagId, tag);

  return getReleaseWorkbenchView(ref, { requireCommunityAccess: false });
};

/**
 * Detach the tag and record it in the release's history. The release was read
 * before this transaction and can be deleted in between (#596): that answers as
 * the read would have.
 */
const removeTagWithHistory = async (
  ref: ReleaseWorkbenchRef,
  tagId: number,
  tag: { name: string } | null
) => {
  try {
    await prisma.$transaction(async (tx) => {
      const currentRelease = await tx.release.findUniqueOrThrow({
        where: { id: ref.releaseId },
        include: { releaseTags: { include: { tag: true } } }
      });
      const postRemovalSnapshot: ReleaseSnapshot = {
        ...snapshotRelease(currentRelease),
        tagIds: currentRelease.releaseTags
          .filter((rt) => rt.tag.id !== tagId)
          .map((rt) => rt.tag.id)
          .sort((a, b) => a - b),
        tagNames: currentRelease.releaseTags
          .filter((rt) => rt.tag.id !== tagId)
          .map((rt) => rt.tag.name)
          .sort()
      };
      await tx.releaseTag.deleteMany({
        where: { releaseId: ref.releaseId, tagId: tagId }
      });
      await tx.tag.update({
        where: { id: tagId },
        data: { occurrences: { decrement: 1 } }
      });
      await tx.releaseHistory.create({
        data: {
          releaseId: ref.releaseId,
          actorId: ref.actorId,
          action: ReleaseHistoryAction.tag_removed,
          summary: `Tag "${tag?.name ?? `#${tagId}`}" removed`,
          changedFields: ['tags'],
          before: tag ? ({ tagId: tagId, name: tag.name } as never) : undefined,
          snapshot: postRemovalSnapshot as never
        }
      });
    });
  } catch (err) {
    translatePrismaError(err, {
      P2003: [404, 'Release or tag not found'],
      P2025: [404, 'Release or tag not found']
    });
  }
};
