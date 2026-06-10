import {
  ArtistRole,
  ReleaseHistoryAction,
  ReleaseTagVoteDirection
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import type { CreateGroupInput } from '../schemas/community';
import {
  snapshotRelease,
  type ReleaseSnapshot
} from './releaseWorkbench/snapshot';

const buildPlainTags = (
  releaseTags: Array<{ tag: { id: number; name: string; occurrences: number } }>
) =>
  releaseTags
    .map((releaseTag) => releaseTag.tag)
    .sort((a, b) => a.name.localeCompare(b.name));

const attachTagWithVotes = async (
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

export const createCommunityRelease = async (input: {
  actorId: number;
  communityId: number;
  data: CreateGroupInput;
}) => {
  const community = await prisma.community.findUnique({
    where: { id: input.communityId }
  });
  if (!community) {
    throw new AppError(404, 'Community not found');
  }

  const {
    credits,
    title,
    description,
    type,
    releaseType,
    year,
    image,
    tagIds
  } = input.data;
  const uniqueTagIds = tagIds ? [...new Set(tagIds)] : [];

  return prisma.$transaction(async (tx) => {
    const created = await tx.release.create({
      data: {
        communityId: input.communityId,
        title,
        description,
        type,
        releaseType,
        year,
        image: image ?? null,
        credits: {
          create: credits.map((credit) => ({
            artistId: credit.artistId,
            role: credit.role ?? ArtistRole.Main
          }))
        },
        editions: {
          create: { year, isUnknownEdition: true }
        }
      }
    });

    if (uniqueTagIds.length > 0) {
      const tags = await tx.tag.findMany({
        where: { id: { in: uniqueTagIds } },
        select: { id: true, name: true }
      });
      for (const tag of tags) {
        await tx.tag.update({
          where: { id: tag.id },
          data: { occurrences: { increment: 1 } }
        });
        await attachTagWithVotes(tx, created.id, input.actorId, tag, false);
      }
    }

    const release = await tx.release.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        credits: {
          select: { role: true, artist: { select: { id: true, name: true } } }
        },
        releaseTags: { include: { tag: true } }
      }
    });
    const createdSnapshot = snapshotRelease(release);
    await tx.releaseHistory.create({
      data: {
        releaseId: release.id,
        actorId: input.actorId,
        action: ReleaseHistoryAction.created,
        summary: 'Release created',
        changedFields: [],
        after: createdSnapshot as never,
        snapshot: createdSnapshot as never
      }
    });

    return {
      ...release,
      tags: buildPlainTags(release.releaseTags)
    };
  });
};

export const deleteCommunityRelease = async (input: {
  communityId: number;
  releaseId: number;
}) => {
  const existing = await prisma.release.findFirst({
    where: { id: input.releaseId, communityId: input.communityId },
    select: { id: true, releaseTags: { select: { tagId: true } } }
  });
  if (!existing) {
    throw new AppError(404, 'Release not found');
  }

  await prisma.$transaction(async (tx) => {
    await Promise.all(
      existing.releaseTags.map((tag) =>
        tx.tag.update({
          where: { id: tag.tagId },
          data: { occurrences: { decrement: 1 } }
        })
      )
    );
    await tx.release.delete({ where: { id: input.releaseId } });
  });
};
