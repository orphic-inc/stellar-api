import {
  ArtistRole,
  FileType,
  Prisma,
  ReleaseCategory,
  ReleaseType
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sizeBytesToNumber } from '../lib/serialize';
import { getLogger } from './logging';
import { checkContributionLink } from './linkHealth';
import { resolveTagNames } from './tag';
import type {
  AddContributionToReleaseInput,
  CreateContributionInput
} from '../schemas/contribution';

const log = getLogger('contribution');

const normalizeTags = (tags?: string): string[] => [
  ...new Set(
    (tags ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  )
];

export const createContributionSubmission = async ({
  userId,
  input
}: {
  userId: number;
  input: CreateContributionInput;
}) => {
  const {
    communityId,
    title,
    year,
    type,
    fileType,
    downloadUrl,
    sizeInBytes,
    tags,
    image,
    description,
    releaseDescription,
    bitrate,
    media,
    hasLog,
    hasCue,
    isScene,
    collaborators
  } = input;

  const community = await prisma.community.findUnique({
    where: { id: communityId }
  });
  if (!community) return null;

  const normalizedTags = normalizeTags(tags);
  const canonicalTags = await resolveTagNames(normalizedTags);

  const contribution = await prisma.$transaction(async (tx) => {
    const contributor = await tx.contributor.upsert({
      where: { userId },
      update: {},
      create: { userId, communityId }
    });

    const names = collaborators.map((c) => c.artist);
    const existing = await tx.artist.findMany({
      where: { name: { in: names } }
    });
    const artistMap = new Map(existing.map((artist) => [artist.name, artist]));

    const missingArtists = collaborators.filter(
      (c) => !artistMap.has(c.artist)
    );
    if (missingArtists.length > 0) {
      await tx.artist.createMany({
        data: missingArtists.map((c) => ({
          name: c.artist,
          vanityHouse: false
        })),
        skipDuplicates: true
      });
      const created = await tx.artist.findMany({
        where: { name: { in: missingArtists.map((c) => c.artist) } }
      });
      created.forEach((artist) => artistMap.set(artist.name, artist));
    }

    const collaboratorRecords = collaborators.map(
      (c) => artistMap.get(c.artist)!
    );
    const primaryArtist = collaboratorRecords[0];
    const tagRecords =
      canonicalTags.length > 0
        ? await Promise.all(
            canonicalTags.map((name) =>
              tx.tag.upsert({
                where: { name },
                create: { name, occurrences: 1 },
                update: { occurrences: { increment: 1 } }
              })
            )
          )
        : [];

    const release = await tx.release.create({
      data: {
        communityId,
        title,
        year,
        type,
        releaseType:
          type === ReleaseType.Music
            ? ReleaseCategory.Album
            : ReleaseCategory.Unknown,
        image: image ?? null,
        description: description ?? releaseDescription ?? title,
        contributors: { connect: { id: contributor.id } },
        credits: {
          create: { artistId: primaryArtist.id, role: ArtistRole.Main }
        }
      }
    });

    const edition = await tx.edition.create({
      data: {
        releaseId: release.id,
        year,
        media: media ?? null,
        isUnknownEdition: true
      }
    });

    if (tagRecords.length > 0) {
      await tx.releaseTag.createMany({
        data: tagRecords.map((tag) => ({
          releaseId: release.id,
          tagId: tag.id,
          positiveVotes: 11
        })),
        skipDuplicates: true
      });
    }

    return tx.contribution.create({
      data: {
        userId,
        releaseId: release.id,
        editionId: edition.id,
        contributorId: contributor.id,
        releaseDescription,
        type: fileType as FileType,
        downloadUrl,
        sizeInBytes: sizeInBytes ?? null,
        bitrate: bitrate ?? null,
        hasLog: hasLog ?? false,
        hasCue: hasCue ?? false,
        isScene: isScene ?? false,
        collaborators: {
          connect: collaboratorRecords.map((artist) => ({ id: artist.id }))
        }
      },
      select: {
        id: true,
        userId: true,
        releaseId: true,
        contributorId: true,
        releaseDescription: true,
        sizeInBytes: true,
        approvedAccountingBytes: true,
        linkStatus: true,
        linkCheckedAt: true,
        type: true,
        bitrate: true,
        hasLog: true,
        hasCue: true,
        isScene: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, username: true } },
        release: { select: { id: true, title: true, communityId: true } },
        collaborators: { select: { id: true, name: true } }
      }
    });
  });

  checkContributionLink(contribution.id).catch((err) =>
    log.warn('Initial link check failed', {
      contributionId: contribution.id,
      err
    })
  );

  return {
    ...contribution,
    sizeInBytes: sizeBytesToNumber(contribution.sizeInBytes)
  };
};

export const addContributionToRelease = async ({
  userId,
  communityId,
  releaseId,
  input
}: {
  userId: number;
  communityId: number;
  releaseId: number;
  input: AddContributionToReleaseInput;
}) => {
  const release = await prisma.release.findFirst({
    where: { id: releaseId, communityId }
  });
  if (!release) return null;

  return prisma
    .$transaction(async (tx: Prisma.TransactionClient) => {
      const contributor = await tx.contributor.upsert({
        where: { userId },
        update: { communityId },
        create: { userId, communityId }
      });

      // Every contribution belongs to an edition; attach to the release's
      // default edition, creating one if the release has none yet.
      const edition =
        (await tx.edition.findFirst({
          where: { releaseId },
          orderBy: { id: 'asc' },
          select: { id: true }
        })) ??
        (await tx.edition.create({
          data: {
            releaseId,
            year: release.year,
            media: input.media ?? null,
            isUnknownEdition: true
          },
          select: { id: true }
        }));

      return tx.contribution.create({
        data: {
          userId,
          releaseId,
          editionId: edition.id,
          contributorId: contributor.id,
          type: input.fileType as FileType,
          downloadUrl: input.downloadUrl,
          sizeInBytes: input.sizeInBytes ?? null,
          releaseDescription: input.releaseDescription,
          bitrate: input.bitrate ?? null,
          hasLog: input.hasLog ?? false,
          hasCue: input.hasCue ?? false,
          isScene: input.isScene ?? false
        },
        select: {
          id: true,
          userId: true,
          releaseId: true,
          contributorId: true,
          releaseDescription: true,
          sizeInBytes: true,
          approvedAccountingBytes: true,
          linkStatus: true,
          linkCheckedAt: true,
          type: true,
          bitrate: true,
          hasLog: true,
          hasCue: true,
          isScene: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, username: true } },
          release: { select: { id: true, title: true, communityId: true } },
          collaborators: { select: { id: true, name: true } }
        }
      });
    })
    .then((contribution) => {
      checkContributionLink(contribution.id).catch((err) =>
        log.warn('Initial link check failed', {
          contributionId: contribution.id,
          err
        })
      );
      return {
        ...contribution,
        sizeInBytes: sizeBytesToNumber(contribution.sizeInBytes)
      };
    });
};
