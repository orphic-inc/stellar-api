/**
 * devTools/generators/releases.ts
 *
 * Generates Artist, Release, ReleaseTag, ReleaseTagVote, ReleaseHistory,
 * ReleaseVote, ReleaseVoteAggregate, ArtistHistory, ArtistAlias, SimilarArtist,
 * ArtistTag, Bookmark, Comment, and Subscription rows.
 *
 * In isolated mode: creates new Tag rows with "seed." prefix.
 * In integrated mode: may reuse existing tags (tracks mutations).
 *
 * Coverage:
 *   Models: Artist, Release, Tag, ReleaseTag, ReleaseTagVote, ReleaseHistory,
 *           ReleaseVote, ReleaseVoteAggregate, ArtistHistory, ArtistAlias,
 *           SimilarArtist, ArtistTag, BookmarkRelease, Comment
 *   Edge cases: release with 0 contributions, release with max tags,
 *               artist with alias, artist with similar artists
 */

import {
  PrismaClient,
  ArtistRole,
  ReleaseCategory,
  ReleaseMedia,
  ReleaseType,
  ReleaseTagVoteDirection
} from '@prisma/client';
import { RunContext } from '../types';
import {
  pick,
  pickN,
  randInt,
  randBool,
  daysAgo,
  SeedContext
} from '../seedRandom';
import {
  makeArtistName,
  makeAlbumTitle,
  makeReleaseDescription,
  makeRecordLabel,
  makeCatalogueNumber,
  makeTagSet,
  makeTagSet as makeArtistTagSet,
  makeBBCodeForumPost
} from '../contentFactory';
import { trackCreate } from '../tracking';

const RELEASE_CATEGORIES: ReleaseCategory[] = [
  'Album',
  'Single',
  'EP',
  'Anthology',
  'Compilation',
  'DJMix',
  'Live',
  'Remix',
  'Bootleg',
  'Mixtape',
  'Demo'
];

const CATEGORY_WEIGHTS = [45, 10, 15, 2, 8, 3, 7, 3, 2, 3, 2];

const RELEASE_TYPES: ReleaseType[] = [
  'Music',
  'Applications',
  'EBooks',
  'ELearningVideos',
  'Audiobooks',
  'Comedy',
  'Comics'
];

const RELEASE_MEDIA: ReleaseMedia[] = [
  'CD',
  'WEB',
  'Vinyl',
  'SACD',
  'DVD',
  'Cassette',
  'BluRay',
  'DAT',
  'Soundboard',
  'Other'
];

function pickCategory(rng: SeedContext): ReleaseCategory {
  const total = CATEGORY_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < RELEASE_CATEGORIES.length; i++) {
    r -= CATEGORY_WEIGHTS[i];
    if (r <= 0) return RELEASE_CATEGORIES[i];
  }
  return 'Album';
}

/**
 * Get or create a Tag by name. In isolated mode, names start with "seed.".
 * Returns the tag id.
 */
async function getOrCreateTag(
  prisma: PrismaClient,
  name: string
): Promise<number> {
  const existing = await prisma.tag.findUnique({ where: { name } });
  if (existing) {
    await prisma.tag.update({
      where: { id: existing.id },
      data: { occurrences: { increment: 1 } }
    });
    return existing.id;
  }
  const tag = await prisma.tag.create({
    data: { name, occurrences: 1 }
  });
  return tag.id;
}

export async function generateReleases(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  const { config, runId } = ctx;
  const rng = new SeedContext(config.seed).fork('releases');
  const isolated = config.mode === 'isolated';

  if (ctx.generatedCommunityIds.length === 0) {
    return;
  }

  const users = ctx.generatedUserIds;
  if (users.length === 0) return;

  const createdArtistIds: number[] = [];
  const createdReleaseIds: number[] = [];

  // Track tags we create in isolated mode so cleanup can delete them
  const seedTagIds: number[] = [];

  for (const communityId of ctx.generatedCommunityIds) {
    // Edge case: leave ~10% of communities release-free
    if (config.includeEdgeCases && randBool(0.1, rng)) {
      continue;
    }

    const releaseCount = Math.max(
      1,
      Math.round(config.counts.releasesPerCommunity * config.scale)
    );

    for (let r = 0; r < releaseCount; r++) {
      const artistName = makeArtistName(rng);
      const createdAt = daysAgo(0, 3 * 365, rng);
      const actorId = pick(users, rng);

      // Artist
      const artist = await prisma.artist.create({
        data: { name: artistName }
      });
      createdArtistIds.push(artist.id);
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'Artist',
        { id: artist.id }
      );

      // Artist history
      const artistHistory = await prisma.artistHistory.create({
        data: {
          artistId: artist.id,
          data: { name: artistName },
          editedBy: actorId,
          editedAt: createdAt,
          description: 'Artist created'
        }
      });
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'ArtistHistory',
        { id: artistHistory.id }
      );

      // Artist alias (30% chance) — redirectId points back to the same artist as placeholder
      if (randBool(0.3, rng)) {
        const alias = await prisma.artistAlias.create({
          data: { artistId: artist.id, redirectId: artist.id, userId: actorId }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'ArtistAlias',
          { id: alias.id }
        );
      }

      // Artist tags (in isolated mode, use seed. prefix)
      const artistTagNames = makeArtistTagSet(
        rng,
        isolated,
        randInt(1, 3, rng)
      );
      for (const tagName of artistTagNames) {
        const tagId = await getOrCreateTag(prisma, tagName);
        if (isolated && !seedTagIds.includes(tagId)) {
          seedTagIds.push(tagId);
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'Tag',
            { id: tagId }
          );
        }
        try {
          await prisma.artistTag.create({
            data: {
              artistId: artist.id,
              tagId,
              positiveVotes: randInt(1, 20, rng),
              negativeVotes: randInt(0, 2, rng),
              userId: actorId
            }
          });
        } catch {
          // Skip duplicate
        }
      }

      // Release
      const title = makeAlbumTitle(rng);
      const year = randInt(1960, 2024, rng);
      const releaseCategory = pickCategory(rng);
      const releaseType = pick(RELEASE_TYPES, rng);
      const hasEdition = randBool(0.3, rng);

      const release = await prisma.release.create({
        data: {
          title: title.substring(0, 100),
          description: makeReleaseDescription(rng).substring(0, 1000),
          communityId,
          type: releaseType,
          releaseType: releaseCategory,
          year,
          credits: { create: { artistId: artist.id, role: ArtistRole.Main } },
          createdAt,
          updatedAt: createdAt
        }
      });
      createdReleaseIds.push(release.id);

      // Default (unknown) edition every release has, plus an optional named
      // edition. Label/catalogue/media are edition-scoped now.
      await prisma.edition.create({
        data: {
          releaseId: release.id,
          year,
          media: pick(RELEASE_MEDIA, rng),
          catalogueNumber: randBool(0.7, rng) ? makeCatalogueNumber(rng) : null,
          recordLabel: randBool(0.7, rng) ? makeRecordLabel(rng) : null,
          isUnknownEdition: true,
          createdAt,
          updatedAt: createdAt
        }
      });
      if (hasEdition) {
        await prisma.edition.create({
          data: {
            releaseId: release.id,
            title: pick(
              ['Deluxe', 'Remastered', 'Anniversary', 'Limited'],
              rng
            ),
            year: year + randInt(0, 30, rng),
            media: pick(RELEASE_MEDIA, rng),
            catalogueNumber: randBool(0.7, rng)
              ? makeCatalogueNumber(rng)
              : null,
            recordLabel: randBool(0.7, rng) ? makeRecordLabel(rng) : null,
            isRemaster: true,
            createdAt,
            updatedAt: createdAt
          }
        });
      }
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'Release',
        { id: release.id }
      );

      // Release history: "created" entry
      const relHistory = await prisma.releaseHistory.create({
        data: {
          releaseId: release.id,
          actorId,
          action: 'created',
          summary: 'Release created',
          changedFields: [],
          snapshot: { title, year, artistName },
          createdAt
        }
      });
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'ReleaseHistory',
        { id: relHistory.id }
      );

      // Optional edit history
      if (randBool(0.4, rng)) {
        const editHistory = await prisma.releaseHistory.create({
          data: {
            releaseId: release.id,
            actorId: pick(users, rng),
            action: 'edit',
            summary: 'Metadata corrected',
            changedFields: ['title', 'year'],
            before: { title: 'Old Title', year: year - 1 },
            after: { title, year },
            snapshot: { title, year, artistName },
            createdAt: new Date(createdAt.getTime() + 86400000)
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'ReleaseHistory',
          { id: editHistory.id }
        );
      }

      // Release tags
      const tagNames = makeTagSet(rng, isolated, randInt(2, 6, rng));
      for (const tagName of tagNames) {
        const tagId = await getOrCreateTag(prisma, tagName);
        if (isolated && !seedTagIds.includes(tagId)) {
          seedTagIds.push(tagId);
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'Tag',
            { id: tagId }
          );
        }

        try {
          const releaseTag = await prisma.releaseTag.create({
            data: {
              releaseId: release.id,
              tagId,
              positiveVotes: randInt(1, 60, rng),
              negativeVotes: randInt(0, 3, rng),
              userId: actorId,
              createdAt,
              updatedAt: createdAt
            }
          });
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'ReleaseTag',
            { id: releaseTag.id }
          );

          // Tag votes from a few users
          const voterCount = randInt(1, Math.min(5, users.length), rng);
          const voters = pickN(users, voterCount, rng);
          for (const voterId of voters) {
            try {
              const direction: ReleaseTagVoteDirection = randBool(0.85, rng)
                ? 'up'
                : 'down';
              const tagVote = await prisma.releaseTagVote.create({
                data: {
                  releaseTagId: releaseTag.id,
                  userId: voterId,
                  direction,
                  createdAt: daysAgo(0, 365, rng)
                }
              });
              await trackCreate(
                prisma as Parameters<typeof trackCreate>[0],
                runId,
                'ReleaseTagVote',
                { id: tagVote.id }
              );
            } catch {
              // Duplicate vote — skip
            }
          }
        } catch {
          // Duplicate tag — skip
        }
      }

      // Release votes (70% of releases get votes)
      if (randBool(0.7, rng)) {
        const voterCount = randInt(1, Math.min(15, users.length), rng);
        const voters = pickN(users, voterCount, rng);
        let ups = 0;
        let total = 0;
        for (const voterId of voters) {
          const positive = randBool(0.75, rng);
          if (positive) ups++;
          total++;
          try {
            const vote = await prisma.releaseVote.create({
              data: {
                releaseId: release.id,
                userId: voterId,
                positive,
                createdAt: daysAgo(0, 365, rng),
                updatedAt: daysAgo(0, 365, rng)
              }
            });
            await trackCreate(
              prisma as Parameters<typeof trackCreate>[0],
              runId,
              'ReleaseVote',
              { id: vote.id }
            );
          } catch {
            // Duplicate vote — skip
          }
        }

        // Vote aggregate (binomial score approximation)
        const score = total > 0 ? (ups / total) * Math.log(1 + total) : 0;
        try {
          const agg = await prisma.releaseVoteAggregate.upsert({
            where: { releaseId: release.id },
            create: {
              releaseId: release.id,
              ups,
              total,
              score,
              updatedAt: new Date()
            },
            update: { ups, total, score, updatedAt: new Date() }
          });
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'ReleaseVoteAggregate',
            { id: agg.id }
          );
        } catch {
          // skip
        }
      }

      // Comments on release (from generated users)
      const commentCount = randBool(0.6, rng) ? randInt(1, 5, rng) : 0;
      for (let c = 0; c < commentCount; c++) {
        const commentAuthorId = pick(users, rng);
        const comment = await prisma.comment.create({
          data: {
            page: 'release',
            authorId: commentAuthorId,
            body: makeBBCodeForumPost(rng).substring(0, 1000),
            releaseId: release.id,
            createdAt: daysAgo(0, 365, rng)
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'Comment',
          { id: comment.id }
        );
        ctx.generatedCommentIds.push(comment.id);
      }

      // Bookmarks (some users bookmark releases)
      const bookmarkCount = randInt(0, Math.min(3, users.length), rng);
      const bookmarkUsers = pickN(users, bookmarkCount, rng);
      for (const bUserId of bookmarkUsers) {
        try {
          await prisma.bookmarkRelease.create({
            data: {
              userId: bUserId,
              releaseId: release.id,
              sort: randInt(1, 100, rng),
              createdAt: daysAgo(0, 365, rng)
            }
          });
        } catch {
          // Duplicate bookmark — skip
        }
      }
    }

    // SimilarArtist links between some generated artists
    if (createdArtistIds.length >= 2) {
      const pairsToCreate = Math.min(
        Math.floor(createdArtistIds.length / 3),
        10
      );
      for (let p = 0; p < pairsToCreate; p++) {
        const aIdx = randInt(0, createdArtistIds.length - 1, rng);
        let bIdx = randInt(0, createdArtistIds.length - 1, rng);
        if (bIdx === aIdx) bIdx = (bIdx + 1) % createdArtistIds.length;
        try {
          const sim = await prisma.similarArtist.create({
            data: {
              artistId: createdArtistIds[aIdx],
              similarArtistId: createdArtistIds[bIdx],
              score: randInt(1, 100, rng),
              votes: {}
            }
          });
          await trackCreate(
            prisma as Parameters<typeof trackCreate>[0],
            runId,
            'SimilarArtist',
            { id: sim.id }
          );
        } catch {
          // Duplicate — skip
        }
      }
    }
  }

  ctx.generatedArtistIds = createdArtistIds;
  ctx.generatedReleaseIds = createdReleaseIds;
  ctx.summary['Artist'] = createdArtistIds.length;
  ctx.summary['Release'] = createdReleaseIds.length;
  ctx.summary['Tag'] = seedTagIds.length;
}
