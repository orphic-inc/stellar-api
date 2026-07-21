import express from 'express';
import { z } from 'zod';
import { assets } from '../../modules/config';
import { asyncHandler } from '../../modules/asyncHandler';
import { validateParams, parsedParams } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import {
  getAssetByHash,
  uploadAsset,
  assetUrl
} from '../../modules/assetStore';
import { ALLOWED_MIMES } from '../../lib/assetValidate';

const router = express.Router();

// sha256 hex — the content address, not a row id, so no z.coerce.number here.
const assetHashParamsSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/)
});

/**
 * POST /api/asset — store an uploaded image, returning its content address (#342).
 *
 * No `?kind=`: the only member-uploadable kind is `ThemeImage` (fonts stay
 * seeder-only — the #343 redistribution boundary — and `uploadAsset` enforces
 * image-only bytes on top of that). The param comes back the day a second kind
 * is uploadable.
 *
 * `express.raw`, not multipart: the payload is exactly one binary that
 * `validateAsset` identifies by magic bytes, so the filename and part headers
 * multipart carries are things this route would discard — skipping it keeps a
 * parser dependency out of the tree for a body we already refuse to trust the
 * client's description of. The parser `limit` refuses an oversize body before it
 * is buffered; the global `express.json()` ignores these bodies (it only claims
 * `application/json`).
 */
router.post(
  '/',
  requireAuth,
  express.raw({ type: ALLOWED_MIMES as string[], limit: assets.maxBytes }),
  asyncHandler(async (req, res) => {
    // A Content-Type outside the allowlist leaves express.raw with nothing to
    // claim, so req.body arrives as the empty object express.json left behind.
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError(
        400,
        `Send the asset as a raw body with a Content-Type of: ${ALLOWED_MIMES.join(
          ', '
        )}.`
      );
    }

    const rank = await prisma.userRank.findUnique({
      where: { id: req.user!.userRankId },
      select: { assetLimit: true }
    });

    const asset = await uploadAsset({
      data: req.body,
      kind: 'ThemeImage',
      // The declared type is cross-checked against the payload's magic bytes,
      // never trusted — the claim validateAsset exists to catch.
      mime: req.get('content-type')?.split(';')[0]?.trim(),
      ownerId: req.user!.id,
      // null = unlimited (staff); 0 = no uploads (rejected in uploadAsset); N = cap.
      assetLimit: rank?.assetLimit ?? null
    });

    res.status(201).json({
      hash: asset.hash,
      url: assetUrl(asset.hash),
      mime: asset.mime,
      size: asset.size,
      kind: asset.kind
    });
  })
);

// GET /api/asset/:hash — deliver a stored asset by content address (ADR-0026).
//
// Delivery policy is DERIVED from `ownerId`, not a separate column (#342):
//   - null  → a site-shipped fixture: reviewed in this repository, fetched as a
//     CSS subresource, served unauthenticated. An auth round-trip buys nothing
//     over non-secret bytes at an unguessable address.
//   - set   → a member upload: auth-gated, matching the sibling `/css` route on
//     an invite-only instance, and cached `private` so a shared cache cannot
//     hand the bytes to an anonymous fetch.
// A member-visible tier, not owner-private: theme imagery is referenced from
// sheets other members can adopt. An owner-private tier is an unexercised branch
// today and is deferred with avatars (#396).
//
// Composed as real middleware — resolve the row, serve it outright when it is
// site-owned, else fall through to `requireAuth` before delivery. Calling
// requireAuth inside a handler means hand-rolling its next/response contract,
// which is how a gate ends up passing when it should not.
type ResolvedAsset = NonNullable<Awaited<ReturnType<typeof getAssetByHash>>>;

const deliver = (res: express.Response, asset: ResolvedAsset): void => {
  // Immutable is literally true here: the bytes at a hash cannot change, so a
  // cached copy can never go stale and never needs revalidating.
  // nosniff for the same reason the /css route sets it — the stored mime was
  // verified against the payload's magic bytes at ingest, so pin it (no helmet).
  res.setHeader('Content-Type', asset.mime);
  res.setHeader(
    'Cache-Control',
    asset.ownerId === null
      ? 'public, max-age=31536000, immutable'
      : 'private, max-age=31536000, immutable'
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('ETag', `"${asset.hash}"`);
  res.send(asset.data);
};

router.get(
  '/:hash',
  validateParams(assetHashParamsSchema),
  asyncHandler(async (_req, res, next) => {
    const { hash } = parsedParams<{ hash: string }>(res);
    const asset = await getAssetByHash(hash);
    if (!asset) {
      res.status(404).json({ msg: 'Asset not found' });
      return;
    }
    res.locals.asset = asset;
    if (asset.ownerId === null) {
      deliver(res, asset);
      return;
    }
    next();
  }),
  requireAuth,
  asyncHandler(async (_req, res) => {
    deliver(res, res.locals.asset as ResolvedAsset);
  })
);

export default router;
