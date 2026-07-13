import {
  ArtistRole,
  FileType,
  Prisma,
  RatioExempt,
  ReleaseCategory,
  ReleaseType
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { audit } from '../lib/audit';
import { sizeBytesToNumber } from '../lib/serialize';
import { getLogger } from './logging';
import { checkContributionLink } from './linkHealth';
import { assertWithinSizeCap } from './contributionLimits';
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

// UI role labels ("Main artist", "Remixer", legacy "main") → ArtistRole. Kept
// tolerant of casing and a trailing "artist"/"artists"; anything unrecognised
// (including the non-music "Creator"/"Contributor"/"Editor" labels) falls back
// to Main so a credit is always created.
const ROLE_BY_LABEL: Record<string, ArtistRole> = {
  main: ArtistRole.Main,
  guest: ArtistRole.Guest,
  composer: ArtistRole.Composer,
  conductor: ArtistRole.Conductor,
  dj: ArtistRole.DJ,
  remixer: ArtistRole.Remixer,
  producer: ArtistRole.Producer,
  arranger: ArtistRole.Arranger
};

const roleFromImportance = (importance: string): ArtistRole => {
  const normalized = importance
    .trim()
    .toLowerCase()
    .replace(/\s*artists?$/, '');
  return ROLE_BY_LABEL[normalized] ?? ArtistRole.Main;
};

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
    releaseCategory,
    recordLabel,
    catalogueNumber,
    editionTitle,
    editionYear,
    isRemaster,
    hasLog,
    hasCue,
    isScene,
    collaborators
  } = input;

  // Reject oversized contributions before any DB work (#93). The release type
  // is in the body on this path.
  assertWithinSizeCap(type, sizeInBytes);

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

    // One ReleaseArtist credit per collaborator with its mapped role, deduped
    // on artist+role to respect the ReleaseArtist @@unique([releaseId, artistId,
    // role]) constraint when the same artist is listed twice in one role.
    const seenCredits = new Set<string>();
    const creditData = collaborators.flatMap((c) => {
      const artist = artistMap.get(c.artist)!;
      const role = roleFromImportance(c.importance);
      const key = `${artist.id}:${role}`;
      if (seenCredits.has(key)) return [];
      seenCredits.add(key);
      return [{ artistId: artist.id, role }];
    });

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
          releaseCategory ??
          (type === ReleaseType.Music
            ? ReleaseCategory.Album
            : ReleaseCategory.Unknown),
        image: image ?? null,
        description: description ?? releaseDescription ?? title,
        contributors: { connect: { id: contributor.id } },
        credits: { create: creditData }
      }
    });

    const hasEditionMeta = Boolean(
      recordLabel ||
        catalogueNumber ||
        editionTitle ||
        editionYear ||
        isRemaster
    );
    const edition = await tx.edition.create({
      data: {
        releaseId: release.id,
        title: editionTitle ?? null,
        year: editionYear ?? year,
        recordLabel: recordLabel ?? null,
        catalogueNumber: catalogueNumber ?? null,
        media: media ?? null,
        isRemaster: isRemaster ?? false,
        isUnknownEdition: !hasEditionMeta
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
        releaseFile: {
          create: {
            bitrate: bitrate ?? null,
            hasLog: hasLog ?? false,
            hasCue: hasCue ?? false,
            isScene: isScene ?? false
          }
        },
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
        releaseFile: {
          select: { bitrate: true, hasLog: true, hasCue: true, isScene: true }
        },
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

  // Reject oversized contributions (#93). On this path the category comes from
  // the release the file is being attached to, not the request body.
  assertWithinSizeCap(release.type, input.sizeInBytes);

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
          releaseFile: {
            create: {
              bitrate: input.bitrate ?? null,
              hasLog: input.hasLog ?? false,
              hasCue: input.hasCue ?? false,
              isScene: input.isScene ?? false
            }
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
          releaseFile: {
            select: {
              bitrate: true,
              hasLog: true,
              hasCue: true,
              isScene: true
            }
          },
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

// Staff lever (PRD-06 #4): set/clear a Contribution's ratio exemption. Applies to
// future consumption only — already-completed grants snapshotted their exemption,
// so this never retroactively rewrites past accounting. Audited as an economy lever.
export const setContributionRatioExempt = async (
  actorId: number,
  contributionId: number,
  ratioExempt: RatioExempt
): Promise<{ id: number; ratioExempt: RatioExempt }> => {
  const contribution = await prisma.contribution.findUnique({
    where: { id: contributionId },
    select: { id: true, ratioExempt: true }
  });
  if (!contribution) throw new AppError(404, 'Contribution not found');

  if (contribution.ratioExempt === ratioExempt)
    return { id: contribution.id, ratioExempt };

  return prisma.$transaction(async (tx) => {
    const updated = await tx.contribution.update({
      where: { id: contributionId },
      data: { ratioExempt },
      select: { id: true, ratioExempt: true }
    });
    await audit(
      tx,
      actorId,
      'contribution.ratio_exempt.set',
      'contribution',
      contributionId,
      { from: contribution.ratioExempt, to: ratioExempt }
    );
    return updated;
  });
};
