/**
 * Orphan collection for the asset store (ADR-0026 Phase 2, #342).
 *
 * `Asset.ownerId` cascades on user delete, but nothing collects an asset whose
 * *referencing row* is gone — a deleted or rewritten stylesheet that no longer
 * names it. That is the leak this closes.
 *
 * **Scan, not reference counting.** References live inside freeform CSS text as
 * `url(/api/asset/<hash>)`, so extracting them means parsing that text no matter
 * what — a reference table would just cache the same extraction behind a write
 * path, which is where drift enters, and whose failure mode is deleting a *live*
 * asset. A scan derives the reference set from the sheets themselves each cycle,
 * so it cannot drift, and it stays correct when a row is edited outside the write
 * path (a fixture re-seed, a hand-fixed row).
 *
 * **The grace period is load-bearing.** An upload exists before the sheet that
 * references it — a member stores an image, then saves the sheet that uses it —
 * so a graceless sweep would collect assets out from under a member mid-compose.
 * Nothing younger than `GRACE_MS` is eligible, regardless of reference state.
 *
 * Site-owned assets (`ownerId: null`) are never swept — they are seeded from the
 * repository, and a boot that seeds assets before stylesheets would otherwise
 * present a window where a fixture looks unreferenced.
 *
 * **Imported remote images (#737, ADR-0051)** are referenced by their remote URL,
 * not by an `/api/asset/` path: the member's text keeps the URL they wrote. So an
 * asset is also live while any stored content still references a URL whose
 * `RemoteImage` row points at it, whatever the asset's kind — identical bytes
 * collapse to one row, so an import can share an asset with an upload. When an
 * imported asset is collected its row goes with it (Cascade), and a URL that is
 * referenced again later is simply imported again.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getLogger } from './logging';
import {
  collectImageColumns,
  collectReferencedRemoteUrls,
  remoteUrlsIn
} from './remoteImage';

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
 * Every asset hash currently referenced by a stored row. This function is where
 * "what references an asset" is defined, and the cost of the scan approach: a
 * consumer that forgets to add itself here does not fail loudly, it has its
 * assets collected 24 hours later.
 *
 * Three referrers:
 *
 * - **Author stylesheet sources** — `url(/api/asset/…)`, the only form ADR-0031
 *   permits. Deliberately unfiltered by `deletedAt`: a withdrawn sheet still
 *   serves via `/css` to existing adopters (ADR-0032 §3), so its assets are live
 *   even though every other read path hides the row. This looks like an oversight
 *   next to the filtering elsewhere in this module; it is not.
 * - **Image fields** — every column `collectImageColumns` lists: both avatar
 *   columns (#396; `Profile.avatar` and `User.avatar` are written by different
 *   routes and nothing reconciles them), the donor icon and second avatar (#740,
 *   which this list once missed, deleting an uploaded donor icon a day after
 *   upload), and the rest. One list serves this and the remote URLs below, so a
 *   new image column is added in one place.
 * - **Imported remote images** — the asset behind each still-referenced URL.
 *
 * Fields are scanned as text through the same `extractAssetHashes` as CSS rather
 * than matched as whole values: over-counting a reference leaks an asset, while
 * under-counting deletes a live one, and only one of those is recoverable.
 */
export const collectReferencedHashes = async (
  client: PrismaClient = prisma
): Promise<Set<string>> => {
  const [sheets, columns] = await Promise.all([
    client.authorStylesheet.findMany({ select: { source: true } }),
    collectImageColumns(client)
  ]);
  const referenced = new Set<string>();
  const texts = [...sheets.map((sheet) => sheet.source), ...columns.fields];
  for (const text of texts) {
    for (const hash of extractAssetHashes(text ?? null)) referenced.add(hash);
  }
  const urls = remoteUrlsIn(columns);
  for (const hash of await referencedImportHashes(client, urls))
    referenced.add(hash);
  return referenced;
};

/** The assets behind remote image URLs that stored content still references. */
const referencedImportHashes = async (
  client: PrismaClient,
  urls: Set<string>
): Promise<string[]> => {
  if (urls.size === 0) return [];
  const rows = await client.remoteImage.findMany({
    where: { url: { in: [...urls] }, assetHash: { not: null } },
    select: { assetHash: true }
  });
  return rows.flatMap((r) => (r.assetHash ? [r.assetHash] : []));
};

/**
 * Drop `RemoteImage` rows that never became an asset (pending or failed) and
 * whose URL nothing references any more, past the grace window. They hold no
 * bytes; this only keeps the table from accumulating dead URLs. Imported rows go
 * with their asset instead.
 */
export const pruneUnreferencedRemoteImages = async (
  client: PrismaClient = prisma
): Promise<number> => {
  const urls = await collectReferencedRemoteUrls(client);
  const { count } = await client.remoteImage.deleteMany({
    where: {
      assetHash: null,
      createdAt: { lt: new Date(Date.now() - GRACE_MS) },
      url: { notIn: [...urls] }
    }
  });
  if (count > 0) log.info('Pruned unreferenced remote images', { count });
  return count;
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
  // reclaim bytes, so pulling every candidate blob into memory would defeat it.
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
