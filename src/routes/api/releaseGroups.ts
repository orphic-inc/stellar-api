import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import {
  loadPermissions,
  hasPermission,
  requirePermission
} from '../../middleware/permissions';
import { authHandler } from '../../modules/asyncHandler';
import {
  parsedPage,
  paginatedResponse,
  paginationBase
} from '../../lib/pagination';
import {
  validate,
  validateParams,
  validateQuery,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import {
  addGroupCover,
  createReleaseGroup,
  listGroupCovers,
  listGroupLog,
  mergeReleaseGroups,
  removeGroupCover,
  resolveGroupForViewer,
  splitReleaseGroup,
  updateGroupIdentity
} from '../../modules/releaseGroup';
import {
  addCoverSchema,
  createReleaseGroupSchema,
  mergeReleaseGroupSchema,
  splitReleaseGroupSchema,
  updateReleaseGroupSchema,
  type AddCoverInput,
  type CreateReleaseGroupInput,
  type MergeReleaseGroupInput,
  type SplitReleaseGroupInput,
  type UpdateReleaseGroupInput
} from '../../schemas/releaseGroup';

// ReleaseGroup — cross-community content identity (ADR-0023, #265).
//
// Both routes require a session. That is not incidental: the resolver's whole
// job is to answer "what may THIS viewer see", and there is no anonymous answer
// to that question — `communityReadableWhere` takes a viewer id.

const router = express.Router();

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const coverParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  coverId: z.coerce.number().int().positive()
});
const listQuerySchema = z.object({ ...paginationBase });

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

// ─── Curation verbs (#265 PR2) ───────────────────────────────────────────────
//
// Merge, split and retitle are release-identity moderation: `contributions_manage`.
// Covers are curation, so adding one needs only the ability to reach the group,
// exactly like attaching a release.
//
// All of them go through `resolveGroupForViewer`, so a moderator cannot act on
// a group whose every member sits in a community they cannot see. That is
// deliberate: the permission says what you may DO, not what you may SEE, and
// the leak surface stays the single resolver.

// PUT /api/release-groups/:id
router.put(
  '/:id',
  ...requirePermission('contributions_manage'),
  validateParams(idParamsSchema),
  validate(updateReleaseGroupSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const body = parsedBody<UpdateReleaseGroupInput>(res);
    const group = await updateGroupIdentity({
      actorId: req.user.id,
      groupId: id,
      ...body
    });
    res.json(group);
  })
);

// POST /api/release-groups/:id/merge — fold sourceGroupId into :id. No undo.
router.post(
  '/:id/merge',
  ...requirePermission('contributions_manage'),
  validateParams(idParamsSchema),
  validate(mergeReleaseGroupSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { sourceGroupId } = parsedBody<MergeReleaseGroupInput>(res);
    const result = await mergeReleaseGroups({
      actorId: req.user.id,
      targetId: id,
      sourceId: sourceGroupId
    });
    res.json(result);
  })
);

// POST /api/release-groups/:id/split
router.post(
  '/:id/split',
  ...requirePermission('contributions_manage'),
  validateParams(idParamsSchema),
  validate(splitReleaseGroupSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const body = parsedBody<SplitReleaseGroupInput>(res);
    const result = await splitReleaseGroup({
      actorId: req.user.id,
      groupId: id,
      ...body
    });
    res.json(result);
  })
);

// GET /api/release-groups/:id/log
router.get(
  '/:id/log',
  requireAuth,
  validateParams(idParamsSchema),
  validateQuery(listQuerySchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const pg = parsedPage(res);
    const perms = await loadPermissions(req, res);
    const { data, total } = await listGroupLog(
      id,
      req.user.id,
      hasPermission(perms, 'contributions_manage'),
      { skip: pg.skip, limit: pg.limit }
    );
    paginatedResponse(res, data, total, pg);
  })
);

// GET /api/release-groups/:id/covers
router.get(
  '/:id/covers',
  requireAuth,
  validateParams(idParamsSchema),
  validateQuery(listQuerySchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const pg = parsedPage(res);
    const { data, total } = await listGroupCovers(id, req.user.id, {
      skip: pg.skip,
      limit: pg.limit
    });
    paginatedResponse(res, data, total, pg);
  })
);

// POST /api/release-groups/:id/covers
router.post(
  '/:id/covers',
  requireAuth,
  validateParams(idParamsSchema),
  validate(addCoverSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { image, summary } = parsedBody<AddCoverInput>(res);
    const cover = await addGroupCover({
      actorId: req.user.id,
      groupId: id,
      image,
      summary
    });
    res.status(201).json(cover);
  })
);

// DELETE /api/release-groups/:id/covers/:coverId
router.delete(
  '/:id/covers/:coverId',
  requireAuth,
  validateParams(coverParamsSchema),
  authHandler(async (req, res) => {
    const { id, coverId } = parsedParams<{ id: number; coverId: number }>(res);
    const perms = await loadPermissions(req, res);
    await removeGroupCover({
      actorId: req.user.id,
      groupId: id,
      coverId,
      canModerate: hasPermission(perms, 'contributions_manage')
    });
    res.status(204).send();
  })
);

export default router;
