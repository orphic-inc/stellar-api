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
import type { AssetKind, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
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

  const existing = await client.asset.findUnique({ where: { hash } });
  if (existing) return existing;

  return client.asset.create({
    data: {
      hash,
      mime,
      size: input.data.length,
      kind: input.kind,
      data: input.data,
      ownerId: input.ownerId ?? null
    }
  });
};

/** Resolve a stored asset by its content address. Null when absent. */
export const getAssetByHash = (hash: string, client: PrismaClient = prisma) =>
  client.asset.findUnique({ where: { hash } });

/** The public serve route for a stored asset, by content address. */
export const assetUrl = (hash: string): string => `/api/asset/${hash}`;
