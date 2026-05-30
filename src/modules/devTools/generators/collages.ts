/**
 * devTools/generators/collages.ts
 *
 * Generates Collage, CollageEntry, CollageSubscription, Comment,
 * and BookmarkCollage rows.
 *
 * Coverage:
 *   Models: Collage, CollageEntry, CollageSubscription, BookmarkCollage, Comment
 *   Edge cases: empty collage, near-max collage, locked collage
 */

import { randomBytes } from 'crypto';

import { PrismaClient } from '@prisma/client';
import { RunContext } from '../types';
import {
  pick,
  pickN,
  randInt,
  randBool,
  daysAgo,
  SeedContext
} from '../seedRandom';
import { makeCollageName, makeBBCodeForumPost } from '../contentFactory';
import { trackCreate } from '../tracking';

export async function generateCollages(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  const { config, runId } = ctx;
  const rng = new SeedContext(config.seed).fork('collages');

  if (
    ctx.generatedUserIds.length === 0 ||
    ctx.generatedReleaseIds.length === 0
  ) {
    return;
  }

  const users = ctx.generatedUserIds;
  const releases = ctx.generatedReleaseIds;
  const targetCount = Math.max(
    1,
    Math.round(config.counts.collages * config.scale)
  );

  const createdCollageIds: number[] = [];

  // Random 32-bit offset keeps collage names unique across runs with the same seed.
  const runOffset = randomBytes(4).readUInt32BE(0);

  for (let i = 0; i < targetCount; i++) {
    const ownerId = pick(users, rng);
    const name = makeCollageName(i + runOffset + 1, rng);
    const isLocked = config.includeEdgeCases && i === 0; // first is locked (edge case)
    const maxEntries = randBool(0.2, rng) ? randInt(10, 50, rng) : 0; // 0 = unlimited
    const createdAt = daysAgo(0, 2 * 365, rng);

    const collage = await prisma.collage.create({
      data: {
        name: name.substring(0, 100),
        description: `${makeBBCodeForumPost(rng).substring(0, 400)}`,
        userId: ownerId,
        categoryId: randInt(1, 6, rng), // standard collage category IDs
        isLocked,
        isDeleted: false,
        maxEntries,
        maxEntriesPerUser: randBool(0.3, rng) ? randInt(1, 5, rng) : 0,
        isFeatured: randBool(0.1, rng),
        numEntries: 0, // will be reconciled
        numSubscribers: 0,
        createdAt,
        updatedAt: createdAt
      }
    });
    createdCollageIds.push(collage.id);
    await trackCreate(
      prisma as Parameters<typeof trackCreate>[0],
      runId,
      'Collage',
      { id: collage.id }
    );

    // Edge case: empty collage (skip entries for first if edge case mode)
    if (config.includeEdgeCases && i === 0) {
      continue;
    }

    // Entries — fill the collage with releases
    const effectiveMax =
      maxEntries > 0 ? Math.min(maxEntries, releases.length) : releases.length;

    // near-max for edge case collage
    let entryCount: number;
    if (config.includeEdgeCases && i === targetCount - 1) {
      entryCount = Math.min(effectiveMax, Math.max(effectiveMax - 2, 1));
    } else if (randBool(0.7, rng)) {
      entryCount = randInt(3, Math.min(20, effectiveMax), rng);
    } else {
      entryCount = randInt(1, Math.min(5, effectiveMax), rng);
    }

    const selectedReleases = pickN(
      releases,
      Math.min(entryCount, releases.length),
      rng
    );
    for (let s = 0; s < selectedReleases.length; s++) {
      const entryUserId = pick(users, rng);
      try {
        const entry = await prisma.collageEntry.create({
          data: {
            collageId: collage.id,
            releaseId: selectedReleases[s],
            userId: entryUserId,
            sort: s + 1,
            addedAt: daysAgo(0, 365, rng)
          }
        });
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'CollageEntry',
          { id: entry.id }
        );
      } catch {
        // Duplicate entry — skip
      }
    }

    // Subscriptions
    const subCount = randInt(0, Math.min(10, users.length), rng);
    const subUsers = pickN(users, subCount, rng);
    for (const subUserId of subUsers) {
      try {
        await prisma.collageSubscription.create({
          data: {
            userId: subUserId,
            collageId: collage.id,
            lastVisit: daysAgo(0, 90, rng)
          }
        });
      } catch {
        // Duplicate — skip
      }
    }

    // Comments
    const commentCount = randBool(0.5, rng) ? randInt(1, 4, rng) : 0;
    for (let c = 0; c < commentCount; c++) {
      const commenterId = pick(users, rng);
      const comment = await prisma.comment.create({
        data: {
          page: 'collages',
          authorId: commenterId,
          body: makeBBCodeForumPost(rng).substring(0, 800),
          collageId: collage.id,
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

    // Bookmarks
    const bookmarkCount = randInt(0, Math.min(3, users.length), rng);
    const bookmarkUsers = pickN(users, bookmarkCount, rng);
    for (const bUserId of bookmarkUsers) {
      try {
        await prisma.bookmarkCollage.create({
          data: {
            userId: bUserId,
            collageId: collage.id,
            createdAt: daysAgo(0, 365, rng)
          }
        });
      } catch {
        // Duplicate — skip
      }
    }
  }

  ctx.generatedCollageIds = createdCollageIds;
  ctx.summary['Collage'] = createdCollageIds.length;
}
