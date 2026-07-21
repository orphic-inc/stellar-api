/**
 * Orphan collection for the asset store (ADR-0026 Phase 2, #342).
 *
 * `Asset.ownerId` cascades on user delete, but nothing collects an asset whose
 * *referencing row* is gone — a deleted stylesheet, a replaced avatar. That is
 * the leak this closes.
 *
 * **Scan, not reference counting.** Content-addressing means one asset can be
 * referenced from many rows, so deleting alongside any single referrer is wrong.
 * The alternative to scanning is a reference table maintained on every write,
 * which is exact right up until one call site forgets to maintain it — and the
 * failure mode there is deleting a live asset, not leaking a dead one. A scan
 * derives the reference set from the rows themselves, so it cannot drift, and it
 * stays correct when a row is edited outside the write path (a fixture re-seed,
 * a migration, a hand-fixed row in psql).
 *
 * **The grace period is load-bearing.** An upload exists before the row that
 * references it — a member stores an image, then saves the sheet that uses it —
 * so a sweep with no grace window would collect assets out from under a member
 * mid-compose. Nothing younger than `GRACE_MS` is eligible, regardless of
 * reference state.
 *
 * Site-owned assets (`ownerId: null`) are never swept. They are seeded from the
 * repository, and a boot that seeds assets before stylesheets would otherwise
 * present a window where a fixture looks unreferenced.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getLogger } from './logging';

const log = getLogger('assetSweep');

/** How long an asset is protected from collection regardless of references. */
export const GRACE_MS = 24 * 60 * 60 * 1000;

/** Every `/api/asset/<sha256>` address appearing in a blob of text. */
const ASSET_REF = /\/api\/asset\/([0-9a-f]{64})/g;

/**
 * Extract the asset hashes a piece of text references. Pure, and deliberately
 * text-level rather than CSS-aware: the sweep must see every reference a stored
 * string could resolve to, including one in a context a CSS parser would skip.
 * Over-counting a reference leaks an asset; under-counting deletes a live one.
 */
export const extractAssetHashes = (text: string | null): string[] => {
  if (!text) return [];
  return [...text.matchAll(ASSET_REF)].map((m) => m[1]);
};

/**
 * Every asset hash currently referenced by a stored row.
 *
 * The two referrers today are author stylesheet sources (`url(/api/asset/…)`,
 * the only form ADR-0031 permits) and user avatars. A new consumer must be added
 * here — that is the cost of the scan approach, and it is a visible one: this
 * function is where "what references an asset" is defined.
 */
export const collectReferencedHashes = async (
  client: PrismaClient = prisma
): Promise<Set<string>> => {
  const [sheets, avatars] = await Promise.all([
    client.authorStylesheet.findMany({ select: { source: true } }),
    client.user.findMany({
      where: { avatar: { not: null } },
      select: { avatar: true }
    })
  ]);

  const referenced = new Set<string>();
  for (const sheet of sheets) {
    for (const hash of extractAssetHashes(sheet.source)) referenced.add(hash);
  }
  for (const user of avatars) {
    for (const hash of extractAssetHashes(user.avatar)) referenced.add(hash);
  }
  return referenced;
};

/**
 * Delete member-owned assets that nothing references and that are past the grace
 * window. Returns the number collected.
 */
export const sweepOrphanedAssets = async (
  client: PrismaClient = prisma
): Promise<number> => {
  const referenced = await collectReferencedHashes(client);
  const cutoff = new Date(Date.now() - GRACE_MS);

  // Only the addresses are loaded, never `data` — the point of the sweep is to
  // reclaim bytes, so pulling every candidate blob into memory to decide would
  // defeat it.
  const candidates = await client.asset.findMany({
    where: { ownerId: { not: null }, createdAt: { lt: cutoff } },
    select: { hash: true }
  });

  const orphaned = candidates
    .map((asset) => asset.hash)
    .filter((hash) => !referenced.has(hash));
  if (orphaned.length === 0) return 0;

  const { count } = await client.asset.deleteMany({
    where: { hash: { in: orphaned } }
  });
  log.info('Collected orphaned assets', { count });
  return count;
};
