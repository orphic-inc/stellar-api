import { ArtistRole, Prisma, ReleaseHistoryAction } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { translatePrismaError } from '../lib/prismaErrors';
import { audit } from '../lib/audit';
import type { CreateReleaseInput } from '../schemas/community';
import { snapshotRelease } from './releaseWorkbench/snapshot';
import { logGroupEvent } from './releaseGroup';
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

const CONTRIBUTED = 'A release with contributions cannot be deleted';

/**
 * Claim the release for deletion while it has no contributions (#793). The
 * claim locks the row; a contribution that lands after it still meets the
 * Restrict on the final delete, which answers the same 409.
 */
const claimGhostRelease = async (
  tx: Prisma.TransactionClient,
  communityId: number,
  releaseId: number
) => {
  const claimed = await tx.release.updateMany({
    where: { id: releaseId, communityId, contributions: { none: {} } },
    data: { updatedAt: new Date() }
  });
  if (claimed.count === 1) return;
  const exists = await tx.release.count({
    where: { id: releaseId, communityId }
  });
  throw exists
    ? new AppError(409, CONTRIBUTED)
    : new AppError(404, 'Release not found');
};

/**
 * The release and the rows that would otherwise block or outlive it (#793).
 * Editions, credits and bookmarks are Restrict; comments are SetNull, and would
 * survive with no page. Votes, tags, collage entries and history cascade; Top
 * 10 snapshot entries keep their row with a null release.
 */
const removeReleaseRows = async (
  tx: Prisma.TransactionClient,
  releaseId: number
) => {
  try {
    await tx.comment.deleteMany({ where: { releaseId } });
    await tx.bookmarkRelease.deleteMany({ where: { releaseId } });
    await tx.releaseArtist.deleteMany({ where: { releaseId } });
    await tx.edition.deleteMany({ where: { releaseId } });
    await tx.release.delete({ where: { id: releaseId } });
  } catch (err) {
    // P2025: a concurrent delete won (#596). P2003: a contribution landed
    // after the claim, and Contribution → Release/Edition is Restrict.
    translatePrismaError(err, {
      P2025: [404, 'Release not found'],
      P2003: [409, CONTRIBUTED]
    });
  }
};

/**
 * Delete a release with no contributions, the ghost a release becomes when
 * nothing was ever uploaded to it (#793). A release with any contribution is
 * refused: contributions are never hard-deleted, so it stays.
 */
export const deleteCommunityRelease = async (input: {
  actorId: number;
  communityId: number;
  releaseId: number;
}) => {
  const { actorId, communityId, releaseId } = input;
  await prisma.$transaction(async (tx) => {
    await claimGhostRelease(tx, communityId, releaseId);
    const release = await tx.release.findUniqueOrThrow({
      where: { id: releaseId },
      select: {
        title: true,
        releaseGroupId: true,
        releaseTags: { select: { tagId: true } },
        collageEntries: { select: { collageId: true } }
      }
    });

    await Promise.all(
      release.releaseTags.map((tag) =>
        tx.tag.update({
          where: { id: tag.tagId },
          data: { occurrences: { decrement: 1 } }
        })
      )
    );
    if (release.collageEntries.length > 0) {
      await tx.collage.updateMany({
        where: { id: { in: release.collageEntries.map((e) => e.collageId) } },
        data: { numEntries: { decrement: 1 } }
      });
    }

    await removeReleaseRows(tx, releaseId);

    // History cascades with the release, so the audit row is its record.
    await audit(tx, actorId, 'release.delete', 'Release', releaseId, {
      communityId,
      title: release.title,
      releaseGroupId: release.releaseGroupId
    });
    if (release.releaseGroupId !== null) {
      await logGroupEvent(
        tx,
        release.releaseGroupId,
        actorId,
        `Deleted release "${release.title}" (#${releaseId}).`
      );
    }
  });
};
