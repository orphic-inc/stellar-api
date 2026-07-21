/**
 * The idempotent baseline seed — everything the /install flow needs to exist
 * before the first SysOp is minted: user ranks, the promotion-rule ladder, the
 * default forum structure, the Golden Rules, the reserved System user, and the
 * built-in stylesheet fixtures it owns.
 *
 * Deliberately does NOT create real users and does NOT stamp
 * `SiteSettings.installedAt` — so /install stays available and required after a
 * seed (it mints the SysOp and seeds the default community, which needs one).
 * Every helper here is a no-op when its rows already exist, so this is safe to
 * re-run on every container boot.
 *
 * Single source of truth for the seed sequence, shared by:
 *   - prisma/seed.ts        — dev, via ts-node after `prisma migrate reset`
 *   - src/scripts/seed.ts   — the compiled entrypoint the container runs on boot
 *                             (docker-entrypoint.sh), from dist/ with prod deps.
 */
import { PrismaClient } from '@prisma/client';
import {
  seedRanks,
  seedRankPromotionRules,
  seedForums,
  seedSystemUser
} from './bootstrap';
import { seedGoldenRules } from './goldenRules';
import { seedAssetFixtures } from './assetFixtures';
import { seedStylesheetFixtures } from './stylesheetFixtures';
import { seedWikiFixtures } from './wikiFixtures';

export async function seedAll(client: PrismaClient): Promise<void> {
  await seedRanks(client);
  await seedRankPromotionRules(client);
  await seedForums(client);
  await seedGoldenRules(client);
  // Theme imagery must land before the stylesheets referencing it, or an
  // asset-bearing theme is briefly served with dangling /api/asset targets.
  await seedAssetFixtures(client);
  // System user must precede the stylesheet fixtures it owns (and needs ranks
  // to exist first — it takes the base User rank).
  const systemUserId = await seedSystemUser(client);
  await seedStylesheetFixtures(client, systemUserId);
  // The wiki pages the Golden Rules link to. Also System-owned, so it needs the
  // same predecessor; without it the seeded canon ships dead `/wiki/...` links.
  await seedWikiFixtures(client, systemUserId);
}
