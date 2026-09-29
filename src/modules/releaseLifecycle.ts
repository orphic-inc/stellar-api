import { ArtistRole, Prisma, ReleaseHistoryAction } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { translatePrismaError } from '../lib/prismaErrors';
import type { CreateReleaseInput } from '../schemas/community';
import { snapshotRelease } from './releaseWorkbench/snapshot';
import { attachTagWithVotes, buildPlainTags } from './releaseTags';
import { registerWriteImages } from './remoteImage';

/**
 * Every credited artist must exist (#596). Read first, so the answer can say
 * which kind of id was wrong: a dangling artist id is the body's, so `400`.
 */
const assertCreditedArtistsExist = async (
  credits: CreateReleaseInput['credits']
) => {
  const ids = [...new Set(credits.map((credit) => credit.artistId))];
  const found = await prisma.artist.count({ where: { id: { in: ids } } });
  if (found !== ids.length) {
    throw new AppError(400, 'A credited artist id names nothing');
  }
};

/**
 * The release row with its credits and default edition. Its community was read
 * before the transaction and can be deleted in between (#596), and a credit
 * listed twice in one role violates ReleaseArtist's unique key.
 */
const createReleaseRow = async (
  tx: Prisma.TransactionClient,
  data: Prisma.ReleaseUncheckedCreateInput
) => {
  try {
    return await tx.release.create({ data });
  } catch (err) {
    translatePrismaError(err, {
      P2002: [400, 'An artist is credited twice in the same role'],
      P2003: [404, 'Community not found']
    });
  }
};

export const createCommunityRelease = async (input: {
  actorId: number;
  communityId: number;
  data: CreateReleaseInput;
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
  await assertCreditedArtistsExist(credits);
  // Before the write, so a 429 refuses the release whole (#737).
  await registerWriteImages(
    { bodies: [description], fields: [image] },
    input.actorId
  );

  return prisma.$transaction(async (tx) => {
    const created = await createReleaseRow(tx, {
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
          role: credit.role ?? ArtistRole.Main,
          addedById: input.actorId
        }))
      },
      editions: {
        create: { year, isUnknownEdition: true }
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
    try {
      await tx.release.delete({ where: { id: input.releaseId } });
    } catch (err) {
      // P2025: a concurrent delete won (#596). P2003: every release keeps an
      // edition and Edition → Release is Restrict, so the delete is refused
      // until #793 decides what deleting a release should mean.
      translatePrismaError(err, {
        P2025: [404, 'Release not found'],
        P2003: [
          409,
          'A release with editions or contributions cannot be deleted'
        ]
      });
    }
  });
};
