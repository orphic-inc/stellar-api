import { FileType, Prisma, ReleaseCategory, ReleaseType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type {
  AddContributionToReleaseInput,
  CreateContributionInput
} from '../schemas/contribution';

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
    collaborators
  } = input;

  const community = await prisma.community.findUnique({
    where: { id: communityId }
  });
  if (!community) return null;

  const normalizedTags = normalizeTags(tags);

  const contribution = await prisma.$transaction(async (tx) => {
    const contributor = await tx.contributor.upsert({
      where: { userId },
      update: { communityId },
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

    const release = await tx.release.create({
      data: {
        artistId: primaryArtist.id,
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
        ...(normalizedTags.length > 0 && {
          tags: {
            connectOrCreate: normalizedTags.map((tagName) => ({
              where: { name: tagName },
              create: { name: tagName }
            }))
          }
        })
      },
      include: {
        artist: true,
        tags: true
      }
    });

    return tx.contribution.create({
      data: {
        userId,
        releaseId: release.id,
        contributorId: contributor.id,
        releaseDescription,
        type: fileType as FileType,
        downloadUrl,
        sizeInBytes: sizeInBytes ?? null,
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
        type: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, username: true } },
        release: { select: { id: true, title: true, communityId: true } },
        collaborators: { select: { id: true, name: true } }
      }
    });
  });

  return contribution;
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

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const contributor = await tx.contributor.upsert({
      where: { userId },
      update: { communityId },
      create: { userId, communityId }
    });

    return tx.contribution.create({
      data: {
        userId,
        releaseId,
        contributorId: contributor.id,
        type: input.fileType as FileType,
        downloadUrl: input.downloadUrl,
        sizeInBytes: input.sizeInBytes ?? null,
        releaseDescription: input.releaseDescription
      },
      select: {
        id: true,
        userId: true,
        releaseId: true,
        contributorId: true,
        releaseDescription: true,
        sizeInBytes: true,
        approvedAccountingBytes: true,
        type: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, username: true } },
        release: { select: { id: true, title: true, communityId: true } },
        collaborators: { select: { id: true, name: true } }
      }
    });
  });
};
