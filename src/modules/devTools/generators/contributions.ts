/**
 * devTools/generators/contributions.ts
 *
 * Generates Contribution rows with Consumer/Contributor linkage
 * and DownloadAccessGrant rows for consumed releases.
 *
 * Coverage:
 *   Models: Contribution, Consumer, Contributor, DownloadAccessGrant
 *   Edge cases: release with 0 contributions (explicitly skipped),
 *               release with multiple contributions,
 *               contribution with FAIL link health (seed.invalid URL)
 */

import {
  PrismaClient,
  Bitrate,
  FileType,
  LinkHealthStatus
} from '@prisma/client';
import { RunContext } from '../types';
import { pick, randInt, randBool, daysAgo, SeedContext } from '../seedRandom';
import {
  makeSeedDownloadUrl,
  makeFileSizeBytes,
  makeTransferBytes
} from '../contentFactory';
import { trackCreate } from '../tracking';

// Realistic bitrate options
const BITRATES: Bitrate[] = [
  'Kbps128',
  'Kbps192',
  'Kbps256',
  'Kbps320',
  'KbpsV0',
  'KbpsV2',
  'Lossless',
  'Lossless24',
  'Other'
];

// Realistic file types for contributions
const CONTRIBUTION_FILE_TYPES: FileType[] = [
  'flac',
  'mp3',
  'aac',
  'ogg',
  'wav',
  'm4a'
];

const RELEASE_DESCRIPTIONS = [
  'Ripped from original CD. Fully tagged with embedded cover art.',
  'WEB source. Verified against official release metadata.',
  'Vinyl rip using high-quality stylus. Log included.',
  'Scene release — NFO included. Verified bitrate.',
  'Original press, not remastered. Excellent condition.',
  'Limited edition, includes bonus disc.',
  'Remastered 2019 edition with expanded liner notes.',
  'Direct download from official digital store.',
  'Sourced from Bandcamp — highest quality available.',
  'Archive rip of OOP release. Single available source.'
];

export async function generateContributions(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  const { config, runId } = ctx;
  const rng = new SeedContext(config.seed).fork('contributions');

  if (
    ctx.generatedReleaseIds.length === 0 ||
    ctx.generatedUserIds.length === 0
  ) {
    return;
  }

  const users = ctx.generatedUserIds;
  const createdContributionIds: number[] = [];

  for (const releaseId of ctx.generatedReleaseIds) {
    // ~10% of releases have 0 contributions (edge case)
    if (config.includeEdgeCases && randBool(0.1, rng)) {
      continue;
    }

    // Every contribution belongs to an edition; attach to the release's
    // default edition, creating one if the release somehow has none.
    const edition =
      (await prisma.edition.findFirst({
        where: { releaseId },
        orderBy: { id: 'asc' },
        select: { id: true }
      })) ??
      (await prisma.edition.create({
        data: { releaseId, isUnknownEdition: true },
        select: { id: true }
      }));

    const contributionCount = randBool(0.7, rng) ? 1 : randInt(2, 3, rng);

    for (let c = 0; c < contributionCount; c++) {
      const contributorUserId = pick(users, rng);
      const createdAt = daysAgo(0, 2 * 365, rng);

      // Get or create Contributor record
      let contributor = await prisma.contributor.findUnique({
        where: { userId: contributorUserId }
      });
      if (!contributor) {
        const releaseRow = await prisma.release.findUnique({
          where: { id: releaseId },
          select: { communityId: true }
        });
        const releaseCommunityId =
          releaseRow?.communityId ?? ctx.generatedCommunityIds[0];
        if (!releaseCommunityId) continue; // skip if no community available
        contributor = await prisma.contributor.create({
          data: {
            userId: contributorUserId,
            communityId: releaseCommunityId,
            createdAt,
            updatedAt: createdAt
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'Contributor',
          { id: contributor.id }
        );
      }

      const fileType = pick(CONTRIBUTION_FILE_TYPES, rng);
      const bitrate = pick(BITRATES, rng);
      // sizeInBytes is BIGINT — no need to cap at INT4 / 2 GB anymore.
      const sizeInBytes = makeFileSizeBytes(rng);

      const contribution = await prisma.contribution.create({
        data: {
          userId: contributorUserId,
          releaseId,
          editionId: edition.id,
          contributorId: contributor.id,
          releaseDescription: pick(RELEASE_DESCRIPTIONS, rng).substring(
            0,
            1000
          ),
          downloadUrl: makeSeedDownloadUrl(releaseId, c),
          sizeInBytes,
          approvedAccountingBytes: sizeInBytes,
          linkStatus: 'UNKNOWN' as LinkHealthStatus,
          type: fileType,
          releaseFile: {
            create: {
              bitrate,
              hasLog: randBool(0.4, rng),
              hasCue: randBool(0.3, rng),
              isScene: randBool(0.15, rng)
            }
          },
          createdAt,
          updatedAt: createdAt
        }
      });
      createdContributionIds.push(contribution.id);
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'Contribution',
        { id: contribution.id }
      );

      // Generate consumer + download access grants for some contributions
      const consumerCount = randInt(0, Math.min(5, users.length), rng);
      for (let s = 0; s < consumerCount; s++) {
        const consumerUserId = pick(users, rng);

        // Get or create Consumer record
        let consumer = await prisma.consumer.findUnique({
          where: { userId: consumerUserId }
        });
        if (!consumer) {
          consumer = await prisma.consumer.create({
            data: {
              userId: consumerUserId,
              createdAt,
              updatedAt: createdAt
            }
          });
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'Consumer',
            { id: consumer.id }
          );
        }

        // DownloadAccessGrant — consumerId/contributorId reference User.id (not Consumer/Contributor PK)
        try {
          const amountBytes = makeTransferBytes(rng) / 100n; // smaller portion
          const grantedAt = daysAgo(0, 365, rng);
          const grant = await prisma.downloadAccessGrant.create({
            data: {
              consumerId: consumer.userId,
              contributorId: contributor.userId,
              contributionId: contribution.id,
              amountBytes,
              status: 'COMPLETED',
              idempotencyKey: `seed-${runId}-g-${releaseId}-${c}-${s}`,
              createdAt: grantedAt
            }
          });
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'DownloadAccessGrant',
            { id: grant.id }
          );
        } catch {
          // Duplicate idempotency key — skip
        }
      }
    }
  }

  ctx.generatedContributionIds = createdContributionIds;
  ctx.summary['Contribution'] = createdContributionIds.length;
}
