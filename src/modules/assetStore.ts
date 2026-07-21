/**
 * Binary asset store (ADR-0026, #290) — the api-owned home for bytes a stored
 * row references: theme imagery and web fonts today, content imagery later.
 *
 * Content-addressed. `hash` (sha256 of the payload) is the public address rather
 * than the autoincrement `id`, which buys three things at once: the serve route
 * is not enumerable, `Cache-Control: immutable` is honest because the bytes at a
 * hash can never change, and storing the same file twice collapses to one row
 * instead of duplicating it.
 *
 * These two functions are the entire seam. The backend is a Postgres `Bytes`
 * column because the api container has no writable volume and compose sits behind
 * the ADR-0027 publish/deploy boundary — a filesystem or S3 driver replaces the
 * bodies here without touching a caller.
 */
import { createHash } from 'crypto';
import type { AssetKind, AssetVisibility, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { validateAsset } from '../lib/assetValidate';

/** The content address of a payload — sha256 hex, 64 chars. */
export const hashAsset = (data: Buffer): string =>
  createHash('sha256').update(data).digest('hex');

export interface PutAssetInput {
  data: Buffer;
  kind: AssetKind;
  /** What the caller claims the bytes are; verified against them when given. */
  mime?: string;
  /** Omitted for site-owned assets (the built-in theme fixtures). */
  ownerId?: number;
  /** Defaults to `Members` — the gated tier is the safe end to fail toward. */
  visibility?: AssetVisibility;
}

/**
 * Validate and store a payload, returning its row. Idempotent by content: a
 * repeat put of identical bytes returns the existing row rather than a second
 * copy, which is what makes seeding safe to re-run on every container boot.
 *
 * Throws `AppError` (400) via `validateAsset` on an empty, oversize,
 * unrecognized, or misdeclared payload — nothing unidentified reaches the table.
 *
 * `client` is injectable so the seed path can pass the same PrismaClient the rest
 * of the bootstrap sequence uses.
 */
export const putAsset = async (
  input: PutAssetInput,
  client: PrismaClient = prisma
) => {
  const mime = validateAsset(input.data, input.mime);
  const hash = hashAsset(input.data);
  const visibility = input.visibility ?? 'Members';

  const existing = await client.asset.findUnique({ where: { hash } });
  if (existing) {
    // Dedup can collide across tiers: a member uploading bytes identical to a
    // site fixture resolves to the fixture's row. Widen to Public when the
    // caller asks for it, never narrow — narrowing would let an upload put a
    // seeded theme image behind auth and break it for logged-out delivery.
    if (visibility === 'Public' && existing.visibility !== 'Public') {
      return client.asset.update({
        where: { hash },
        data: { visibility: 'Public' }
      });
    }
    return existing;
  }

  return client.asset.create({
    data: {
      hash,
      mime,
      size: input.data.length,
      kind: input.kind,
      data: input.data,
      ownerId: input.ownerId ?? null,
      visibility
    }
  });
};

/** Resolve a stored asset by its content address. Null when absent. */
export const getAssetByHash = (hash: string, client: PrismaClient = prisma) =>
  client.asset.findUnique({ where: { hash } });

/** Bytes a member is currently storing — the figure the rank budget caps. */
export const getOwnedAssetBytes = async (
  ownerId: number,
  client: PrismaClient = prisma
): Promise<number> => {
  const agg = await client.asset.aggregate({
    where: { ownerId },
    _sum: { size: true }
  });
  return agg._sum.size ?? 0;
};

/**
 * Store a member's upload: the quota-gated entry point, as distinct from
 * `putAsset`, which the seeder uses and which answers to no budget.
 *
 * The budget is checked against bytes already stored, but a repeat upload of
 * bytes the member already owns is *not* charged twice — content-addressing
 * means it stores nothing new, so rejecting it would be charging rent on a row
 * that already exists.
 *
 * Note the ordering: validate before counting. A payload that is oversize or
 * unidentifiable is rejected on its own terms, so the member gets "that file is
 * not a supported image" rather than a quota error that misdescribes the problem.
 */
export const uploadAsset = async (
  input: {
    data: Buffer;
    kind: AssetKind;
    mime?: string;
    ownerId: number;
    assetByteLimit: number;
  },
  client: PrismaClient = prisma
) => {
  const mime = validateAsset(input.data, input.mime);
  const hash = hashAsset(input.data);

  if (input.assetByteLimit > 0) {
    const alreadyOwned = await client.asset.findFirst({
      where: { hash, ownerId: input.ownerId },
      select: { id: true }
    });
    if (!alreadyOwned) {
      const used = await getOwnedAssetBytes(input.ownerId, client);
      if (used + input.data.length > input.assetByteLimit) {
        throw new AppError(
          400,
          `Asset storage limit reached (${input.assetByteLimit} bytes; ${used} in use).`
        );
      }
    }
  }

  return putAsset(
    {
      data: input.data,
      kind: input.kind,
      mime,
      ownerId: input.ownerId,
      visibility: 'Members'
    },
    client
  );
};

/** The public serve route for a stored asset, by content address. */
export const assetUrl = (hash: string): string => `/api/asset/${hash}`;
