import express from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { translatePrismaError } from '../../lib/prismaErrors';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  validateQuery,
  parsedBody,
  parsedParams,
  parsedQuery
} from '../../middleware/validate';
import { parsedPage, paginatedResponse } from '../../lib/pagination';
import {
  promoteTag,
  demoteTag,
  listOfficialTags,
  listTags
} from '../../modules/tag';
import {
  promoteTagSchema,
  tagsQuerySchema,
  type PromoteTagInput,
  type TagsQuery
} from '../../schemas/tags';

/**
 * The curated tag vocabulary (#298, ADR-0045).
 *
 * TWO READS, SPLIT BY AUDIENCE, and the split is the point. `/official` is what a
 * member's tag picker fetches, so it is `requireAuth` and returns the whole
 * curated set; `/` is the curation surface's own list over the unbounded tag
 * table, so it is `tags_manage` and paginated. Merging them would either
 * staff-gate the picker or hand every member a paged view of every tag ever
 * minted.
 *
 * THIS ROUTER IS NOT `tag-aliases`, though they sit together in the staff tools.
 * Aliases normalize (bad name → good name, applied at write); this curates (which
 * good names are worth offering). `tags_manage` gates the writes on both, because
 * its registry description already claims "related tag tooling" — but the alias
 * router gates its GET too, and this one must not.
 */
const router = express.Router();

const officialParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/tags/official — the curated vocabulary, for a member's tag picker.
// Registered before any parameterized route so Express cannot shadow it.
router.get(
  '/official',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await listOfficialTags());
  })
);

// GET /api/tags — every tag, paginated, for the curation surface.
router.get(
  '/',
  ...requirePermission('tags_manage'),
  validateQuery(tagsQuerySchema),
  asyncHandler(async (_req, res) => {
    const pg = parsedPage(res);
    const { q } = parsedQuery<TagsQuery>(res);
    const [tags, total] = await listTags({ q, skip: pg.skip, limit: pg.limit });
    paginatedResponse(res, tags, total, pg);
  })
);

// POST /api/tags/official — promote a tag, creating it when absent.
router.post(
  '/official',
  ...requirePermission('tags_manage'),
  validate(promoteTagSchema),
  authHandler(async (req, res) => {
    const { name } = parsedBody<PromoteTagInput>(res);
    const tag = await promoteTag(name);
    // `requested` and `name` differ when the typed name was folded or redirected
    // through the alias table. This row is the only record that happened.
    await audit(prisma, req.user.id, 'tag.promote', 'Tag', tag.id, {
      requested: name,
      resolved: tag.name
    });
    res.status(201).json(tag);
  })
);

// DELETE /api/tags/:id/official — demote a tag. The row itself is never deleted.
router.delete(
  '/:id/official',
  ...requirePermission('tags_manage'),
  validateParams(officialParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    let tag;
    try {
      tag = await demoteTag(id);
    } catch (err) {
      // `update` addressed by id — P2025 on a model with no FK of its own (#564).
      translatePrismaError(err, { P2025: [404, 'Tag not found'] });
    }
    await audit(prisma, req.user.id, 'tag.demote', 'Tag', tag.id, {
      name: tag.name
    });
    res.json(tag);
  })
);

export default router;
