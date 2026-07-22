import express, { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import {
  validate,
  validateParams,
  validateQuery,
  parsedParams,
  parsedBody
} from '../../../middleware/validate';
import {
  createGroupSchema,
  updateGroupSchema,
  releaseVoteSchema,
  releaseTagSchema,
  releaseTagVoteSchema,
  type CreateGroupInput,
  type UpdateGroupInput,
  type ReleaseVoteInput,
  type ReleaseTagInput,
  type ReleaseTagVoteInput
} from '../../../schemas/community';
import {
  addContributionToReleaseSchema,
  type AddContributionToReleaseInput
} from '../../../schemas/contribution';
import { resolveTagName } from '../../../modules/tag';
import {
  parsedPage,
  paginatedResponse,
  paginationBase
} from '../../../lib/pagination';
import { releaseWorkbench } from '../../../modules/releaseWorkbench';
import type { ReleaseWorkbenchView } from '../../../modules/releaseWorkbench/types';
import {
  createCommunityRelease,
  deleteCommunityRelease
} from '../../../modules/releaseLifecycle';
import { listCommunityReleases } from '../../../modules/releaseBrowse';
import { renderSiteBBCode } from '../../../modules/bbcodeRender';

const router = express.Router({ mergeParams: true });
const communityIdParamsSchema = z.object({
  communityId: z.coerce.number().int().positive()
});
const releasesQuerySchema = z.object({ ...paginationBase });
const releaseHistoryQuerySchema = z.object({ ...paginationBase });
const releaseParamsSchema = z.object({
  communityId: z.coerce.number().int().positive(),
  releaseId: z.coerce.number().int().positive()
});

const serializeReleaseWorkbenchView = async (view: ReleaseWorkbenchView) => {
  return {
    ...view.release,
    // Additive render-at-read: raw `description` is unchanged; `descriptionHtml`
    // is the server-rendered BBCode transcription the detail view consumes (#402).
    descriptionHtml: await renderSiteBBCode(view.release.description),
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
  validateParams(communityIdParamsSchema),
  validateQuery(releasesQuerySchema),
  authHandler(async (req, res) => {
    const { communityId } = parsedParams<{ communityId: number }>(res);
    const pg = parsedPage(res);
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
  validateParams(releaseParamsSchema),
  validateQuery(releaseHistoryQuerySchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const pg = parsedPage(res);
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

router.post(
  '/:releaseId/history/:historyId/revert',
  ...requirePermission('communities_manage', 'admin'),
  validateParams(revertParamsSchema),
  authHandler(async (req, res) => {
    const {
      communityId,
      releaseId: id,
      historyId
    } = parsedParams<{
      communityId: number;
      releaseId: number;
      historyId: number;
    }>(res);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId: id,
      permissions: req.user.permissions
    });
    const view = await session.revertHistory({ historyId });
    res.json(await serializeReleaseWorkbenchView(view));
  })
);

// GET /api/communities/:communityId/releases/:releaseId
router.get(
  '/:releaseId',
  requireAuth,
  validateParams(releaseParamsSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const session = await releaseWorkbench.open({
      actorId: req.user.id,
      communityId,
      releaseId,
      permissions: req.user.permissions
    });
    res.json(await serializeReleaseWorkbenchView(await session.getView()));
  })
);

// POST /api/communities/:communityId/releases — requires communities_manage
router.post(
  '/',
  ...requirePermission('communities_manage'),
  validateParams(communityIdParamsSchema),
  validate(createGroupSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId } = parsedParams<{ communityId: number }>(res);
    const release = await createCommunityRelease({
      actorId: req.user!.id,
      communityId,
      data: parsedBody<CreateGroupInput>(res)
    });
    res.status(201).json(release);
  })
);

// PUT /api/communities/:communityId/releases/:releaseId — contributor or communities_manage
router.put(
  '/:releaseId',
  requireAuth,
  validateParams(releaseParamsSchema),
  validate(updateGroupSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const { title, description, image, year, editSummary } =
      parsedBody<UpdateGroupInput>(res);
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
    res.json(await serializeReleaseWorkbenchView(view));
  })
);

// GET /api/communities/:communityId/releases/:releaseId/contributions — release-scoped
// read carrying rip-quality (ReleaseFile) + edition identity for the edition stack.
router.get(
  '/:releaseId/contributions',
  requireAuth,
  validateParams(releaseParamsSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
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
  validateParams(releaseParamsSchema),
  validate(addContributionToReleaseSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const input = parsedBody<AddContributionToReleaseInput>(res);
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

// POST /api/communities/:communityId/releases/:releaseId/vote
router.post(
  '/:releaseId/vote',
  requireAuth,
  validateParams(releaseParamsSchema),
  validate(releaseVoteSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const { positive } = parsedBody<ReleaseVoteInput>(res);
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
  validateParams(releaseParamsSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
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
  validateParams(releaseParamsSchema),
  validate(releaseTagSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const { name: submittedName } = parsedBody<ReleaseTagInput>(res);
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
  validateParams(tagParamsSchema),
  validate(releaseTagVoteSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId, tagId } = parsedParams<{
      communityId: number;
      releaseId: number;
      tagId: number;
    }>(res);
    const { direction } = parsedBody<ReleaseTagVoteInput>(res);
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
  validateParams(tagParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) return res.status(401).json({ msg: 'Unauthorized' });
    const actorId = req.user.id;
    const {
      communityId,
      releaseId: id,
      tagId
    } = parsedParams<{
      communityId: number;
      releaseId: number;
      tagId: number;
    }>(res);

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

// DELETE /api/communities/:communityId/releases/:releaseId — requires communities_manage
router.delete(
  '/:releaseId',
  ...requirePermission('communities_manage'),
  validateParams(releaseParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId, releaseId } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    await deleteCommunityRelease({ communityId, releaseId });
    res.status(204).send();
  })
);

export default router;
