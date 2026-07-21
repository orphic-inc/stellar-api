import express from 'express';
import { z } from 'zod';
import { assets } from '../../modules/config';
import { asyncHandler } from '../../modules/asyncHandler';
import {
  validateParams,
  parsedParams,
  validateQuery,
  parsedQuery
} from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import {
  getAssetByHash,
  getOwnedAssetBytes,
  uploadAsset,
  assetUrl
} from '../../modules/assetStore';
import { ALLOWED_MIMES } from '../../lib/assetValidate';

const router = express.Router();

// sha256 hex — the content address, not a row id, so no z.coerce.number here.
const assetHashParamsSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/)
});

// Only the kinds a member may upload. `ThemeFont` is deliberately absent:
// shipping a font is a redistribution question the uploader cannot answer for
// the site (it is what keeps postmod ui-static — #343), so fonts stay a
// seeder-only kind until someone decides that on the record.
const uploadQuerySchema = z.object({
  kind: z.enum(['ThemeImage', 'Avatar'])
});

/**
 * POST /api/asset?kind=… — store an uploaded binary, returning its address.
 *
 * `express.raw` rather than multipart: the payload is exactly one binary, and
 * `validateAsset` identifies it by magic bytes, so the filename and part headers
 * multipart exists to carry are things this route would throw away. Avoiding it
 * keeps a parser dependency out of the tree for a body we already refuse to
 * trust the client's description of.
 *
 * The `limit` is the store's own cap, so an oversize body is refused by the
 * parser before it is buffered — `validateAsset` re-checks it for the callers
 * that do not come through here. The global `express.json()` ignores these
 * bodies: it only claims `application/json`.
 */
router.post(
  '/',
  requireAuth,
  validateQuery(uploadQuerySchema),
  express.raw({ type: ALLOWED_MIMES as string[], limit: assets.maxBytes }),
  asyncHandler(async (req, res) => {
    const { kind } = parsedQuery<{ kind: 'ThemeImage' | 'Avatar' }>(res);

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
      select: { assetByteLimit: true }
    });

    const asset = await uploadAsset({
      data: req.body,
      kind,
      // The declared type is cross-checked against the payload's magic bytes,
      // never trusted — this is the claim validateAsset exists to catch.
      mime: req.get('content-type')?.split(';')[0]?.trim(),
      ownerId: req.user!.id,
      assetByteLimit: rank?.assetByteLimit ?? 0
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

/**
 * GET /api/asset/usage — what the caller is storing against their rank budget.
 * Registered before `/:hash` so the static segment is not shadowed.
 */
router.get(
  '/usage',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [used, rank] = await Promise.all([
      getOwnedAssetBytes(req.user!.id),
      prisma.userRank.findUnique({
        where: { id: req.user!.userRankId },
        select: { assetByteLimit: true }
      })
    ]);

    // 0 means unlimited, matching the sibling rank limits; surfaced as null so a
    // client does not render "0 bytes remaining" for the unrestricted case.
    const limit = rank?.assetByteLimit ?? 0;
    res.json({
      usedBytes: used,
      limitBytes: limit > 0 ? limit : null,
      maxAssetBytes: assets.maxBytes
    });
  })
);

// GET /api/asset/:hash — deliver a stored asset by content address (ADR-0026).
//
// Two visibility tiers (#342). `Public` is the site-shipped fixture set: theme
// imagery reviewed in this repository and fetched as a CSS subresource, where an
// auth round-trip buys nothing over non-secret bytes at an unguessable address.
// `Members` is everything uploaded, and requires auth — the same posture as the
// sibling `/css` route, since the instance is invite-only.
//
// Member-visible, not owner-private, is the right tier for both current
// consumers: theme imagery is referenced from sheets other members can adopt,
// and an avatar renders to every viewer of a profile or post. An owner-private
// tier would be an authorization branch nothing exercises.
//
// Non-enumerability is a side effect of the content address, not the reason for
// it — content-addressing follows from immutability, which is what makes it work.
//
// Composed as three handlers rather than one so the auth gate stays real
// middleware: resolve the row, serve it outright when it is Public, and
// otherwise fall through to `requireAuth` before the delivery handler runs. The
// alternative — calling requireAuth inside a handler — means hand-rolling its
// next/response contract, which is how a gate ends up passing when it should not.
type ResolvedAsset = NonNullable<Awaited<ReturnType<typeof getAssetByHash>>>;

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
    if (asset.visibility === 'Public') {
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

const deliver = (res: express.Response, asset: ResolvedAsset): void => {
  // Immutable is literally true here: the bytes at a hash cannot change, so a
  // cached copy can never go stale and never needs revalidating.
  // nosniff for the same reason the /css route sets it — the stored mime was
  // verified against the payload's magic bytes at ingest, so pin it (no helmet).
  res.setHeader('Content-Type', asset.mime);
  res.setHeader(
    'Cache-Control',
    asset.visibility === 'Public'
      ? 'public, max-age=31536000, immutable'
      : // Member assets are immutable too, but must never sit in a shared cache
        // where an unauthenticated fetch could be served the stored copy.
        'private, max-age=31536000, immutable'
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('ETag', `"${asset.hash}"`);
  res.send(asset.data);
};

export default router;
