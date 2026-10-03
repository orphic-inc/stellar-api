import express, { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import {
  validate,
  validateParams,
  validateQuery
} from '../../../middleware/validate';
import {
  createReleaseSchema,
  updateReleaseSchema,
  releaseVoteSchema,
  releaseTagSchema,
  releaseTagVoteSchema,
  releaseCreditSchema,
  releaseCreditRoleSchema
} from '../../../schemas/community';
import { addContributionToReleaseSchema } from '../../../schemas/contribution';
import { resolveTagName } from '../../../modules/tag';
import {
  paginatedResponse,
  paginationBase,
  pageOf
} from '../../../lib/pagination';
import { releaseWorkbench } from '../../../modules/releaseWorkbench';
import type { ReleaseWorkbenchView } from '../../../modules/releaseWorkbench/types';
import {
  createCommunityRelease,
  deleteCommunityRelease
} from '../../../modules/releaseLifecycle';
import { listCommunityReleases } from '../../../modules/releaseBrowse';
import { setReleaseGroup } from '../../../modules/releaseGroup';
import { primaryArtist } from '../../../modules/releaseCredits';
import { setReleaseGroupSchema } from '../../../schemas/releaseGroup';
import {
  renderSiteBBCode,
  resolveViewer,
  type BBViewer
} from '../../../modules/bbcodeRender';

const router = express.Router({ mergeParams: true });
const updateReleaseBody = validate(updateReleaseSchema);
const setReleaseGroupBody = validate(setReleaseGroupSchema);
const releaseVoteBody = validate(releaseVoteSchema);
const releaseTagVoteBody = validate(releaseTagVoteSchema);
const releaseTagBody = validate(releaseTagSchema);
const releaseCreditRoleBody = validate(releaseCreditRoleSchema);
const releaseCreditBody = validate(releaseCreditSchema);
const createReleaseBody = validate(createReleaseSchema);
const addContributionToReleaseBody = validate(addContributionToReleaseSchema);
const communityIdParamsSchema = z.object({
  communityId: z.coerce.number().int().positive()
});
const communityIdParams = validateParams(communityIdParamsSchema);
const releasesQuerySchema = z.object({ ...paginationBase });
const releasesQuery = validateQuery(releasesQuerySchema);
const releaseHistoryQuerySchema = z.object({ ...paginationBase });
const releaseHistoryQuery = validateQuery(releaseHistoryQuerySchema);
const releaseParamsSchema = z.object({
  communityId: z.coerce.number().int().positive(),
  releaseId: z.coerce.number().int().positive()
});
const releaseParams = validateParams(releaseParamsSchema);

const serializeReleaseWorkbenchView = async (
  view: ReleaseWorkbenchView,
  bbViewer: BBViewer
) => {
  return {
    ...view.release,
    // The contract has always declared `artist`, but this route sent only the
    // raw `credits` since the credits remodel (#72), so the release page never
    // showed its artist. Derived like every other release surface (#721).
    artist: primaryArtist(view.release.credits),
    // Additive render-at-read: raw `description` is unchanged; `descriptionHtml`
    // is the server-rendered BBCode transcription the detail view consumes (#402).
    descriptionHtml: await renderSiteBBCode(view.release.description, bbViewer),
    // Additive (ADR-0037 §3). Identity inlines because seeing the release
    // already entitles the viewer to it; the sibling list stays behind
    // `resolveGroupForViewer` and is not here.
    group: view.group,
    tags: view.tags,
    myVote: view.myVote,
    releaseTags: view.releaseTags,
    isContributor: view.isContributor
  };
};

// GET /api/communities/:communityId/releases
router.get(
  '/',
  requireAuth,
  communityIdParams,
  releasesQuery,
  authHandler(async (req, res) => {
    const { communityId } = communityIdParams.read(res);
    const pg = pageOf(releasesQuery.read(res));
    const result = await listCommunityReleases({
      actorId: req.user.id,
      communityId,
      page: pg.page,
      limit: pg.limit
    });
    paginatedResponse(res, result.data, result.total, pg);
  })
);

// GET /api/communities/:communityId/releases/:releaseId/history
router.get(
  '/:releaseId/history',
  requireAuth,
  releaseParams,
  releaseHistoryQuery,
  authHandler(async (req, res) => {
    const { communityId, releaseId } = releaseParams.read(res);
    const pg = pageOf(releaseHistoryQuery.read(res));
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId
    });
    const history = await session.getHistoryPage({
      page: pg.page,
      limit: pg.limit
    });
    res.json({
      data: history.data,
      meta: {
        total: history.total,
        page: history.page,
        limit: history.limit,
        totalPages: history.totalPages
      }
    });
  })
);

// POST /api/communities/:communityId/releases/:releaseId/history/:historyId/revert — requires communities_manage or staff/admin
const revertParamsSchema = z.object({
  communityId: z.coerce.number().int().positive(),
  releaseId: z.coerce.number().int().positive(),
  historyId: z.coerce.number().int().positive()
});
const revertParams = validateParams(revertParamsSchema);

router.post(
  '/:releaseId/history/:historyId/revert',
  ...requirePermission('communities_manage', 'admin'),
  revertParams,
  authHandler(async (req, res) => {
    const { communityId, releaseId: id, historyId } = revertParams.read(res);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId: id,
      permissions: req.user.permissions
    });
    const view = await session.revertHistory({ historyId });
    res.json(
      await serializeReleaseWorkbenchView(view, await resolveViewer(req))
    );
  })
);

// GET /api/communities/:communityId/releases/:releaseId
router.get(
  '/:releaseId',
  requireAuth,
  releaseParams,
  authHandler(async (req, res) => {
    const { communityId, releaseId } = releaseParams.read(res);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId,
      permissions: req.user.permissions
    });
    res.json(
      await serializeReleaseWorkbenchView(
        await session.getView(),
        await resolveViewer(req)
      )
    );
  })
);

// POST /api/communities/:communityId/releases — requires communities_manage
router.post(
  '/',
  ...requirePermission('communities_manage'),
  communityIdParams,
  createReleaseBody,
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId } = communityIdParams.read(res);
    const release = await createCommunityRelease({
      actorId: req.user!.id,
      communityId,
      data: createReleaseBody.read(res)
    });
    res.status(201).json(release);
  })
);

// PUT /api/communities/:communityId/releases/:releaseId — contributor or communities_manage
router.put(
  '/:releaseId',
  requireAuth,
  releaseParams,
  updateReleaseBody,
  authHandler(async (req, res) => {
    const { communityId, releaseId } = releaseParams.read(res);
    const { title, description, image, year, editSummary } =
      updateReleaseBody.read(res);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId,
      permissions: req.user.permissions
    });
    const view = await session.updateMetadata({
      title,
      description,
      image,
      year,
      editSummary
    });
    res.json(
      await serializeReleaseWorkbenchView(view, await resolveViewer(req))
    );
  })
);

// GET /api/communities/:communityId/releases/:releaseId/contributions — release-scoped
// read carrying rip-quality (ReleaseFile) + edition identity for the edition stack.
router.get(
  '/:releaseId/contributions',
  requireAuth,
  releaseParams,
  authHandler(async (req, res) => {
    const { communityId, releaseId } = releaseParams.read(res);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId,
      permissions: req.user.permissions
    });
    res.json(await session.listContributions());
  })
);

// POST /api/communities/:communityId/releases/:releaseId/contributions — any authenticated user
router.post(
  '/:releaseId/contributions',
  requireAuth,
  releaseParams,
  addContributionToReleaseBody,
  authHandler(async (req, res) => {
    const { communityId, releaseId } = releaseParams.read(res);
    const input = addContributionToReleaseBody.read(res);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId,
      permissions: req.user.permissions
    });
    const contribution = await session.attachContribution(input);
    res.status(201).json(contribution);
  })
);

// ─── Vote routes ─────────────────────────────────────────────────────────────

const tagParamsSchema = z.object({
  communityId: z.coerce.number().int().positive(),
  releaseId: z.coerce.number().int().positive(),
  tagId: z.coerce.number().int().positive()
});
const tagParams = validateParams(tagParamsSchema);

// POST /api/communities/:communityId/releases/:releaseId/vote
router.post(
  '/:releaseId/vote',
  requireAuth,
  releaseParams,
  releaseVoteBody,
  authHandler(async (req, res) => {
    const { communityId, releaseId } = releaseParams.read(res);
    const { positive } = releaseVoteBody.read(res);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId,
      permissions: req.user.permissions
    });
    const view = await session.vote({ direction: positive ? 'up' : 'down' });
    res.json({
      myVote: view.myVote,
      voteAggregate: view.release.voteAggregate
    });
  })
);

// DELETE /api/communities/:communityId/releases/:releaseId/vote
router.delete(
  '/:releaseId/vote',
  requireAuth,
  releaseParams,
  authHandler(async (req, res) => {
    const { communityId, releaseId } = releaseParams.read(res);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId,
      permissions: req.user.permissions
    });
    const view = await session.vote({ direction: 'clear' });
    res.json({
      myVote: view.myVote,
      voteAggregate: view.release.voteAggregate
    });
  })
);

// ─── Tag routes ───────────────────────────────────────────────────────────────

// POST /api/communities/:communityId/releases/:releaseId/tags
router.post(
  '/:releaseId/tags',
  requireAuth,
  releaseParams,
  releaseTagBody,
  authHandler(async (req, res) => {
    const { communityId, releaseId } = releaseParams.read(res);
    const { name: submittedName } = releaseTagBody.read(res);
    const name = await resolveTagName(submittedName);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId,
      permissions: req.user.permissions
    });
    const view = await session.addTag({ name: submittedName });
    const tag = view.releaseTags.find((releaseTag) => releaseTag.name === name);
    res.status(201).json(tag ?? view.releaseTags[0]);
  })
);

// POST /api/communities/:communityId/releases/:releaseId/tags/:tagId/vote
router.post(
  '/:releaseId/tags/:tagId/vote',
  requireAuth,
  tagParams,
  releaseTagVoteBody,
  authHandler(async (req, res) => {
    const { communityId, releaseId, tagId } = tagParams.read(res);
    const { direction } = releaseTagVoteBody.read(res);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId,
      permissions: req.user.permissions
    });
    res.json(await session.voteTag({ tagId, direction }));
  })
);

// DELETE /api/communities/:communityId/releases/:releaseId/tags/:tagId
router.delete(
  '/:releaseId/tags/:tagId',
  ...requirePermission('communities_manage'),
  tagParams,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) return res.status(401).json({ msg: 'Unauthorized' });
    const actorId = req.user.id;
    const { communityId, releaseId: id, tagId } = tagParams.read(res);

    const session = await releaseWorkbench.open({
      actorId,
      communityId,
      releaseId: id,
      permissions: req.user.permissions
    });
    await session.removeTag({ tagId });
    res.status(204).send();
  })
);

// ─── Credit routes (#721) ─────────────────────────────────────────────────────

const creditParamsSchema = z.object({
  communityId: z.coerce.number().int().positive(),
  releaseId: z.coerce.number().int().positive(),
  creditId: z.coerce.number().int().positive()
});
const creditParams = validateParams(creditParamsSchema);

// POST /api/communities/:communityId/releases/:releaseId/credits
router.post(
  '/:releaseId/credits',
  requireAuth,
  releaseParams,
  releaseCreditBody,
  authHandler(async (req, res) => {
    const { communityId, releaseId } = releaseParams.read(res);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId,
      permissions: req.user.permissions
    });
    const credit = await session.addCredit(releaseCreditBody.read(res));
    res.status(201).json(credit);
  })
);

// PATCH /api/communities/:communityId/releases/:releaseId/credits/:creditId
router.patch(
  '/:releaseId/credits/:creditId',
  requireAuth,
  creditParams,
  releaseCreditRoleBody,
  authHandler(async (req, res) => {
    const { communityId, releaseId, creditId } = creditParams.read(res);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId,
      permissions: req.user.permissions
    });
    const { role } = releaseCreditRoleBody.read(res);
    res.json(await session.changeCreditRole({ creditId, role }));
  })
);

// DELETE /api/communities/:communityId/releases/:releaseId/credits/:creditId
router.delete(
  '/:releaseId/credits/:creditId',
  requireAuth,
  creditParams,
  authHandler(async (req, res) => {
    const { communityId, releaseId, creditId } = creditParams.read(res);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId,
      permissions: req.user.permissions
    });
    await session.removeCredit({ creditId });
    res.status(204).send();
  })
);

// PUT /api/communities/:communityId/releases/:releaseId/release-group
//
// Attach this release to a cross-community identity node, or detach it with
// `null` (ADR-0023, #265). The day-to-day curation verb.
//
// Named `release-group`, not `group`: "group" was this router's word for the
// Release itself — the create body above was `createGroupSchema` until #603
// renamed it to `createReleaseSchema`. ADR-0023's group is the identity one
// level above that, so the two must not share a word here.
//
// Gated by community access rather than a permission, and it REFUSES rather
// than filtering: the path names one community, so the caller is owed a
// straight answer. `setReleaseGroup` runs `assertCommunityAccess`, so you may
// only group releases you can already reach. That is the read/write asymmetry
// `communityAccess.ts` documents, applied one level up.
router.put(
  '/:releaseId/release-group',
  requireAuth,
  releaseParams,
  setReleaseGroupBody,
  authHandler(async (req, res) => {
    const { communityId, releaseId } = releaseParams.read(res);
    const { releaseGroupId } = setReleaseGroupBody.read(res);

    const updated = await setReleaseGroup({
      actorId: req.user.id,
      communityId,
      releaseId,
      releaseGroupId
    });
    res.json(updated);
  })
);

// DELETE /api/communities/:communityId/releases/:releaseId — requires communities_manage
router.delete(
  '/:releaseId',
  ...requirePermission('communities_manage'),
  releaseParams,
  authHandler(async (req, res) => {
    const { communityId, releaseId } = releaseParams.read(res);
    await deleteCommunityRelease({
      actorId: req.user.id,
      communityId,
      releaseId
    });
    res.status(204).send();
  })
);

export default router;
