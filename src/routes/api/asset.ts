import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../modules/asyncHandler';
import { validateParams, parsedParams } from '../../middleware/validate';
import { getAssetByHash } from '../../modules/assetStore';

const router = express.Router();

// sha256 hex — the content address, not a row id, so no z.coerce.number here.
const assetHashParamsSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/)
});

// GET /api/asset/:hash — deliver a stored asset by content address (ADR-0026).
//
// Unauthenticated, unlike the sibling `/css` route, because of what these bytes
// ARE: site-shipped theme imagery reviewed in the repository (`putAsset` is
// reachable only from the seeder — ADR-0031 §4 leans on that normatively), so an
// auth round-trip buys nothing over content that is already public and immutable.
// `/css` stays authed because it serves member-authored content, and the instance
// is invite-only (ADR-0024, 2026-07-19 amendment).
//
// Non-enumerability is a side effect of the content address, not the reason for
// it — content-addressing follows from immutability, which is what makes it work.
// The sibling route's sequential ids are enumerable and that is accepted: authored
// sheets carry no confidentiality expectation, since adoption requires any member
// to be able to fetch another member's sheet.
//
// When user-uploaded private assets land (Phase 2), they get an explicit
// visibility column and a gate here — this is not a licence to serve anything.
router.get(
  '/:hash',
  validateParams(assetHashParamsSchema),
  asyncHandler(async (_req, res) => {
    const { hash } = parsedParams<{ hash: string }>(res);
    const asset = await getAssetByHash(hash);
    if (!asset) {
      res.status(404).json({ msg: 'Asset not found' });
      return;
    }

    // Immutable is literally true here: the bytes at a hash cannot change, so a
    // cached copy can never go stale and never needs revalidating.
    // nosniff for the same reason the /css route sets it — the stored mime was
    // verified against the payload's magic bytes at ingest, so pin it (no helmet).
    res.setHeader('Content-Type', asset.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('ETag', `"${asset.hash}"`);
    res.send(asset.data);
  })
);

export default router;
