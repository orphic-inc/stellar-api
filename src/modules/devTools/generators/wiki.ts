/**
 * devTools/generators/wiki.ts
 *
 * Generates WikiPage, WikiRevision, and WikiAlias rows with realistic BBCode content.
 * Respects the app's revision-chain invariant: each revision increments sequentially
 * and stores the page body at that point in time.
 *
 * Coverage:
 *   Models: WikiPage, WikiRevision, WikiAlias
 *   Edge cases: stub page (minimal content), large page (many revisions),
 *               page with alias, page with high read level
 */

import { randomBytes } from 'crypto';

import { PrismaClient } from '@prisma/client';
import { RunContext } from '../types';
import { pick, randInt, randBool, daysAgo, SeedContext } from '../seedRandom';
import {
  makeBBCodeWikiPage,
  makeWikiTitle,
  makeWikiSlug
} from '../contentFactory';
import { trackCreate } from '../tracking';

export async function generateWiki(
  prisma: PrismaClient,
  ctx: RunContext
): Promise<void> {
  const { config, runId } = ctx;
  const rng = new SeedContext(config.seed).fork('wiki');

  if (ctx.generatedUserIds.length === 0) return;

  const users = ctx.generatedUserIds;
  const targetCount = Math.max(
    2,
    Math.round(config.counts.wikiPages * config.scale)
  );

  const createdPageIds: number[] = [];
  const usedSlugs = new Set<string>();

  // Random 32-bit offset keeps wiki slugs unique across runs with the same seed.
  const runOffset = randomBytes(4).readUInt32BE(0);

  for (let i = 0; i < targetCount; i++) {
    const title = makeWikiTitle(i + runOffset + 1, rng);
    let slug = makeWikiSlug(title);
    // Ensure slug uniqueness within this run
    if (usedSlugs.has(slug)) {
      slug = `${slug}-${i + runOffset}`;
    }
    usedSlugs.add(slug);

    const authorId = pick(users, rng);
    const createdAt = daysAgo(30, 3 * 365, rng);

    // How many revisions: stub (1), heavily-edited (6–8), or normal (1–4)
    let revisionCount: number;
    if (config.includeEdgeCases && i === 0) {
      revisionCount = 1; // stub page with only 1 revision
    } else if (config.includeEdgeCases && i === 1) {
      revisionCount = randInt(6, 8, rng); // large heavily-edited page
    } else {
      revisionCount = randInt(1, 4, rng);
    }

    // Access levels
    const minReadLevel =
      i === targetCount - 1 && config.includeEdgeCases
        ? 50 // high-read-level edge case
        : 0;
    const minEditLevel = randBool(0.4, rng) ? 25 : 0;

    // Generate each revision's body
    const revisionBodies: string[] = [];
    for (let rev = 0; rev < revisionCount; rev++) {
      revisionBodies.push(makeBBCodeWikiPage(rng));
    }

    const finalBody = revisionBodies[revisionBodies.length - 1];

    // Create the WikiPage at the final revision
    const page = await prisma.wikiPage.create({
      data: {
        title,
        slug,
        body: finalBody,
        revision: revisionCount,
        minReadLevel,
        minEditLevel,
        authorId,
        createdAt,
        updatedAt: createdAt
      }
    });
    createdPageIds.push(page.id);
    await trackCreate(
      prisma as Parameters<typeof trackCreate>[0],
      runId,
      'WikiPage',
      { id: page.id }
    );

    // Create WikiRevision entries (one per revision)
    for (let rev = 1; rev <= revisionCount; rev++) {
      const revEditorId = pick(users, rng);
      const revCreatedAt = new Date(
        createdAt.getTime() + rev * 7 * 24 * 60 * 60 * 1000
      );
      const wikiRev = await prisma.wikiRevision.create({
        data: {
          pageId: page.id,
          revision: rev,
          title,
          body: revisionBodies[rev - 1],
          authorId: revEditorId,
          createdAt: revCreatedAt
        }
      });
      await trackCreate(
        prisma as Parameters<typeof trackCreate>[0],
        runId,
        'WikiRevision',
        { id: wikiRev.id }
      );
    }

    // WikiAlias for some pages (40% chance)
    if (randBool(0.4, rng)) {
      const aliasStr = `seed-alias-${slug.substring(0, 40)}`;
      try {
        await prisma.wikiAlias.create({
          data: {
            alias: aliasStr,
            pageId: page.id,
            userId: authorId,
            createdAt
          }
        });
        // WikiAlias has a string PK (the alias field)
        await trackCreate(
          prisma as Parameters<typeof trackCreate>[0],
          runId,
          'WikiAlias',
          { alias: aliasStr }
        );
      } catch {
        // Duplicate alias — skip
      }
    }
  }

  ctx.generatedWikiPageIds = createdPageIds;
  ctx.summary['WikiPage'] = createdPageIds.length;
}
