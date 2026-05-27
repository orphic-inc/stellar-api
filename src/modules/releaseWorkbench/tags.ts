import {
  Prisma,
  ReleaseHistoryAction,
  ReleaseTagVoteDirection
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { resolveTagName } from '../tag';
import { loadReleaseWorkbenchAuthority } from './authority';
import { getReleaseWorkbenchView } from './load';
import { snapshotRelease, type ReleaseSnapshot } from './snapshot';
import type {
  ReleaseTagView,
  ReleaseWorkbenchRef,
  ReleaseWorkbenchView
} from './types';

const buildReleaseTagPayload = (
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

const attachTagWithVotes = async (
  tx: Prisma.TransactionClient,
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

export const addReleaseWorkbenchTag = async (
  ref: ReleaseWorkbenchRef,
  input: { name: string }
): Promise<ReleaseWorkbenchView> => {
  await loadReleaseWorkbenchAuthority(ref);
  const name = await resolveTagName(input.name);

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
    await prisma.$transaction(async (tx) => {
      await tx.releaseTagVote.create({
        data: {
          releaseTagId: releaseTag.id,
          userId: ref.actorId,
          direction
        }
      });
      if (oppositeVote) {
        await tx.releaseTagVote.delete({ where: { id: oppositeVote.id } });
      }
      await tx.releaseTag.update({
        where: { id: releaseTag.id },
        data:
          direction === ReleaseTagVoteDirection.up
            ? {
                positiveVotes: { increment: 2 },
                ...(oppositeVote ? { negativeVotes: { decrement: 1 } } : {})
              }
            : {
                negativeVotes: { increment: 1 },
                ...(oppositeVote ? { positiveVotes: { decrement: 1 } } : {})
              }
      });
    });
  }

  const updated = await prisma.releaseTag.findUniqueOrThrow({
    where: { id: releaseTag.id },
    include: {
      tag: true,
      user: { select: { id: true, username: true } },
      votes: {
        where: { userId: ref.actorId },
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

  await prisma.$transaction(async (tx) => {
    const currentRelease = await tx.release.findUniqueOrThrow({
      where: { id: ref.releaseId },
      include: { releaseTags: { include: { tag: true } } }
    });
    const postRemovalSnapshot: ReleaseSnapshot = {
      ...snapshotRelease(currentRelease),
      tagIds: currentRelease.releaseTags
        .filter((rt) => rt.tag.id !== input.tagId)
        .map((rt) => rt.tag.id)
        .sort((a, b) => a - b),
      tagNames: currentRelease.releaseTags
        .filter((rt) => rt.tag.id !== input.tagId)
        .map((rt) => rt.tag.name)
        .sort()
    };
    await tx.releaseTag.deleteMany({
      where: { releaseId: ref.releaseId, tagId: input.tagId }
    });
    await tx.tag.update({
      where: { id: input.tagId },
      data: { occurrences: { decrement: 1 } }
    });
    await tx.releaseHistory.create({
      data: {
        releaseId: ref.releaseId,
        actorId: ref.actorId,
        action: ReleaseHistoryAction.tag_removed,
        summary: `Tag "${tag?.name ?? `#${input.tagId}`}" removed`,
        changedFields: ['tags'],
        before: tag
          ? ({ tagId: input.tagId, name: tag.name } as never)
          : undefined,
        snapshot: postRemovalSnapshot as never
      }
    });
  });

  return getReleaseWorkbenchView(ref, { requireCommunityAccess: false });
};
