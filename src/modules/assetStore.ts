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
}

/**
 * Validate and store a payload, returning its row. Idempotent by content: a
 * repeat put of identical bytes returns the existing row rather than a second
 * copy, which is what makes seeding safe to re-run on every container boot.
 *
 * Site-owned intent (`ownerId` omitted) wins a collision: if the bytes already
 * exist under a member's ownership, the row is promoted to site-owned (ownerId
 * nulled). That is the fixture seeder meeting a member who happened to upload
 * byte-identical content first — the asset *is* the shipped fixture it hashes
 * to, so it becomes unauthenticated-servable and sweep-exempt, and drops off the
 * member's quota. Delivery is derived from `ownerId` (null = public site asset,
 * set = member upload, auth-gated), so this single field carries the policy.
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
  const siteOwned = input.ownerId === undefined;

  const existing = await client.asset.findUnique({ where: { hash } });
  if (existing) {
    if (siteOwned && existing.ownerId !== null) {
      return client.asset.update({ where: { hash }, data: { ownerId: null } });
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
      ownerId: input.ownerId ?? null
    }
  });
};

/** Resolve a stored asset by its content address. Null when absent. */
export const getAssetByHash = (hash: string, client: PrismaClient = prisma) =>
  client.asset.findUnique({ where: { hash } });

/** How many assets a member owns — the figure the rank `assetLimit` count caps. */
export const getOwnedAssetCount = (
  ownerId: number,
  client: PrismaClient = prisma
): Promise<number> => client.asset.count({ where: { ownerId } });

/**
 * Store a member's uploaded asset — the quota-gated, image-only entry point, as
 * distinct from `putAsset`, which the seeder uses and which answers to no quota.
 *
 * `assetLimit` carries the rank's allowance in the #342 semantic: `null` =
 * unlimited, `0` = no uploads (rejected here, not at the route, so every caller
 * inherits the gate), a positive N = the cap. A repeat upload of bytes the
 * member already owns is not charged — content-addressing stores nothing new, so
 * charging it would be rent on a row that already exists.
 *
 * Image-only: a member may not smuggle a font in (fonts stay seeder-only, the
 * #343 redistribution boundary). `validateAsset` accepts fonts, so this narrows
 * to `image/*` on top of it. Validate before counting, so an unstorable file
 * reports as a bad file rather than a quota error that misnames the problem.
 */
export const uploadAsset = async (
  input: {
    data: Buffer;
    kind: AssetKind;
    mime?: string;
    ownerId: number;
    assetLimit: number | null;
  },
  client: PrismaClient = prisma
) => {
  const mime = validateAsset(input.data, input.mime);
  if (!mime.startsWith('image/')) {
    throw new AppError(400, `Only images may be uploaded, not ${mime}.`);
  }

  if (input.assetLimit !== null) {
    if (input.assetLimit <= 0) {
      throw new AppError(400, 'Your rank cannot upload assets.');
    }
    const hash = hashAsset(input.data);
    const alreadyOwned = await client.asset.findFirst({
      where: { hash, ownerId: input.ownerId },
      select: { id: true }
    });
    if (!alreadyOwned) {
      const owned = await getOwnedAssetCount(input.ownerId, client);
      if (owned >= input.assetLimit) {
        throw new AppError(400, `Asset limit reached (${input.assetLimit}).`);
      }
    }
  }

  return putAsset(
    { data: input.data, kind: input.kind, mime, ownerId: input.ownerId },
    client
  );
};

/** The public serve route for a stored asset, by content address. */
export const assetUrl = (hash: string): string => `/api/asset/${hash}`;
