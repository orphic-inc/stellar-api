import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { authHandler } from '../../modules/asyncHandler';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import {
  createReleaseGroup,
  resolveGroupForViewer
} from '../../modules/releaseGroup';
import {
  createReleaseGroupSchema,
  type CreateReleaseGroupInput
} from '../../schemas/releaseGroup';

// ReleaseGroup — cross-community content identity (ADR-0023, #265).
//
// Both routes require a session. That is not incidental: the resolver's whole
// job is to answer "what may THIS viewer see", and there is no anonymous answer
// to that question — `communityReadableWhere` takes a viewer id.

const router = express.Router();

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

// GET /api/release-groups/:id
//
// Answers 404 both when the group does not exist and when the viewer can see
// none of its member releases. Those two cases are deliberately
// indistinguishable — telling them apart would make this an existence oracle
// for private catalogues (ADR-0023 Decision 2).
router.get(
  '/:id',
  requireAuth,
  validateParams(idParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const group = await resolveGroupForViewer(id, req.user.id);
    res.json(group);
  })
);

// POST /api/release-groups
//
// Find-or-create: 201 with a new identity, 200 when one already matches.
// Creating a bare identity node reveals nothing about any community's
// catalogue — it has no members until someone attaches a release through the
// community-gated route — so any authenticated member may do it.
router.post(
  '/',
  requireAuth,
  validate(createReleaseGroupSchema),
  authHandler(async (_req, res) => {
    const input = parsedBody<CreateReleaseGroupInput>(res);
    const { group, created } = await createReleaseGroup(input);
    res.status(created ? 201 : 200).json(group);
  })
);

export default router;
