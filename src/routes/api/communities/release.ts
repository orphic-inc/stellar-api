import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import { isCommunityMember } from './communities';
import {
  validate,
  validateParams,
  parsedParams,
  parsedBody
} from '../../../middleware/validate';
import {
  createGroupSchema,
  updateGroupSchema,
  releaseVoteSchema,
  releaseTagSchema,
  type CreateGroupInput,
  type UpdateGroupInput,
  type ReleaseVoteInput,
  type ReleaseTagInput
} from '../../../schemas/community';
import {
  addContributionToReleaseSchema,
  type AddContributionToReleaseInput
} from '../../../schemas/contribution';
import { addContributionToRelease } from '../../../modules/contribution';
import { recomputeVoteAggregate } from '../../../modules/top10';
import { getSettings } from '../../../modules/settings';
import { FileType } from '@prisma/client';
import { parsePage, paginatedResponse } from '../../../lib/pagination';

const router = express.Router({ mergeParams: true });
const communityIdParamsSchema = z.object({
  communityId: z.coerce.number().int().positive()
});
const releaseParamsSchema = z.object({
  communityId: z.coerce.number().int().positive(),
  releaseId: z.coerce.number().int().positive()
});

// GET /api/communities/:communityId/releases
router.get(
  '/',
  requireAuth,
  validateParams(communityIdParamsSchema),
  authHandler(async (req, res) => {
    const { communityId } = parsedParams<{ communityId: number }>(res);
    const community = await prisma.community.findUnique({
      where: { id: communityId },
      select: { registrationStatus: true }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    if (
      !(await isCommunityMember(
        communityId,
        req.user.id,
        community.registrationStatus
      ))
    ) {
      return res.status(403).json({ msg: 'Not a member of this community' });
    }
    const pg = parsePage(req);
    const [releases, total] = await Promise.all([
      prisma.release.findMany({
        where: { communityId },
        skip: pg.skip,
        take: pg.limit,
        include: {
          artist: { select: { id: true, name: true } },
          tags: true,
          _count: { select: { contributions: true } },
          contributions: {
            select: {
              id: true,
              type: true,
              sizeInBytes: true,
              linkStatus: true,
              user: { select: { id: true, username: true } },
              _count: { select: { consumers: true } }
            }
          }
        }
      }),
      prisma.release.count({ where: { communityId } })
    ]);
    paginatedResponse(res, releases, total, pg);
  })
);

// GET /api/communities/:communityId/releases/:releaseId
router.get(
  '/:releaseId',
  requireAuth,
  validateParams(releaseParamsSchema),
  authHandler(async (req, res) => {
    const { communityId, releaseId: id } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const community = await prisma.community.findUnique({
      where: { id: communityId },
      select: { registrationStatus: true }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });
    if (
      !(await isCommunityMember(
        communityId,
        req.user.id,
        community.registrationStatus
      ))
    ) {
      return res.status(403).json({ msg: 'Not a member of this community' });
    }
    const [release, myVoteRecord] = await Promise.all([
      prisma.release.findFirst({
        where: { id, communityId },
        include: {
          artist: true,
          tags: true,
          voteAggregate: true,
          contributions: {
            select: {
              id: true,
              userId: true,
              releaseId: true,
              contributorId: true,
              releaseDescription: true,
              sizeInBytes: true,
              approvedAccountingBytes: true,
              linkStatus: true,
              linkCheckedAt: true,
              type: true,
              createdAt: true,
              updatedAt: true,
              user: { select: { id: true, username: true } },
              collaborators: true
            }
          }
        }
      }),
      prisma.releaseVote.findUnique({
        where: { releaseId_userId: { releaseId: id, userId: req.user.id } },
        select: { positive: true }
      })
    ]);
    if (!release) return res.status(404).json({ msg: 'Release not found' });
    const myVote = myVoteRecord
      ? myVoteRecord.positive
        ? 'up'
        : 'down'
      : null;
    res.json({ ...release, myVote });
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
    const community = await prisma.community.findUnique({
      where: { id: communityId }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });

    const {
      artistId,
      title,
      description,
      type,
      releaseType,
      year,
      image,
      tagIds,
      isEdition,
      edition
    } = parsedBody<CreateGroupInput>(res);

    const release = await prisma.release.create({
      data: {
        artistId,
        communityId,
        title,
        description,
        type,
        releaseType,
        year,
        image: image ?? null,
        isEdition: isEdition ?? false,
        edition: (edition ?? undefined) as never,
        ...(tagIds?.length && {
          tags: { connect: tagIds.map((tid: number) => ({ id: tid })) }
        })
      },
      include: { artist: true, tags: true }
    });
    res.status(201).json(release);
  })
);

// PUT /api/communities/:communityId/releases/:releaseId — requires communities_manage
router.put(
  '/:releaseId',
  ...requirePermission('communities_manage'),
  validateParams(releaseParamsSchema),
  validate(updateGroupSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId, releaseId: id } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);

    const existing = await prisma.release.findFirst({
      where: { id, communityId }
    });
    if (!existing) return res.status(404).json({ msg: 'Release not found' });

    const { title, description, image, year, isEdition, edition, tagIds } =
      parsedBody<UpdateGroupInput>(res);
    const release = await prisma.release.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(image !== undefined && { image }),
        ...(year !== undefined && { year }),
        ...(isEdition !== undefined && { isEdition }),
        ...(edition !== undefined && { edition: edition as never }),
        ...(tagIds !== undefined && {
          tags: { set: tagIds.map((tid: number) => ({ id: tid })) }
        })
      },
      include: { artist: true, tags: true }
    });
    res.json(release);
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

    const settings = await getSettings();
    if (settings.approvedDomains.length > 0) {
      let host: string;
      try {
        host = new URL(input.downloadUrl).hostname;
      } catch {
        return res.status(400).json({ msg: 'Invalid download URL' });
      }
      if (!settings.approvedDomains.includes(host)) {
        return res.status(400).json({
          msg: `Domain '${host}' is not in the approved domains list`
        });
      }
    }

    const community = await prisma.community.findUnique({
      where: { id: communityId },
      select: { allowDuplicateFormats: true }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });

    if (!community.allowDuplicateFormats) {
      const existing = await prisma.contribution.findFirst({
        where: { releaseId, type: input.fileType as FileType }
      });
      if (existing) {
        return res.status(409).json({
          msg: `A ${input.fileType} contribution already exists for this release`
        });
      }
    }

    const contribution = await addContributionToRelease({
      userId: req.user.id,
      communityId,
      releaseId,
      input
    });
    if (!contribution)
      return res.status(404).json({ msg: 'Release not found' });
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
    const { releaseId: id } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const { positive } = parsedBody<ReleaseVoteInput>(res);

    const exists = await prisma.release.findUnique({
      where: { id },
      select: { id: true }
    });
    if (!exists) return res.status(404).json({ msg: 'Release not found' });

    await prisma.releaseVote.upsert({
      where: { releaseId_userId: { releaseId: id, userId: req.user.id } },
      create: { releaseId: id, userId: req.user.id, positive },
      update: { positive }
    });

    await recomputeVoteAggregate(id);

    const aggregate = await prisma.releaseVoteAggregate.findUnique({
      where: { releaseId: id }
    });
    res.json({ myVote: positive ? 'up' : 'down', voteAggregate: aggregate });
  })
);

// DELETE /api/communities/:communityId/releases/:releaseId/vote
router.delete(
  '/:releaseId/vote',
  requireAuth,
  validateParams(releaseParamsSchema),
  authHandler(async (req, res) => {
    const { releaseId: id } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);

    await prisma.releaseVote.deleteMany({
      where: { releaseId: id, userId: req.user.id }
    });

    await recomputeVoteAggregate(id);

    const aggregate = await prisma.releaseVoteAggregate.findUnique({
      where: { releaseId: id }
    });
    res.json({ myVote: null, voteAggregate: aggregate });
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
    const { communityId, releaseId: id } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const { name } = parsedBody<ReleaseTagInput>(res);

    const release = await prisma.release.findFirst({
      where: { id, communityId },
      select: { id: true, tags: { where: { name }, select: { id: true } } }
    });
    if (!release) return res.status(404).json({ msg: 'Release not found' });
    if (release.tags.length > 0)
      return res.status(409).json({ msg: 'Release already has this tag' });

    const tag = await prisma.$transaction(async (tx) => {
      const t = await tx.tag.upsert({
        where: { name },
        create: { name, occurrences: 1 },
        update: { occurrences: { increment: 1 } }
      });
      await tx.release.update({
        where: { id },
        data: { tags: { connect: { id: t.id } } }
      });
      return t;
    });

    res.status(201).json(tag);
  })
);

// DELETE /api/communities/:communityId/releases/:releaseId/tags/:tagId
router.delete(
  '/:releaseId/tags/:tagId',
  requireAuth,
  validateParams(tagParamsSchema),
  authHandler(async (req, res) => {
    const {
      communityId,
      releaseId: id,
      tagId
    } = parsedParams<{
      communityId: number;
      releaseId: number;
      tagId: number;
    }>(res);

    const release = await prisma.release.findFirst({
      where: { id, communityId, tags: { some: { id: tagId } } },
      select: { id: true }
    });
    if (!release)
      return res.status(404).json({ msg: 'Release or tag not found' });

    await prisma.$transaction(async (tx) => {
      await tx.release.update({
        where: { id },
        data: { tags: { disconnect: { id: tagId } } }
      });
      await tx.tag.update({
        where: { id: tagId },
        data: { occurrences: { decrement: 1 } }
      });
    });

    res.status(204).send();
  })
);

// DELETE /api/communities/:communityId/releases/:releaseId — requires communities_manage
router.delete(
  '/:releaseId',
  ...requirePermission('communities_manage'),
  validateParams(releaseParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId, releaseId: id } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const existing = await prisma.release.findFirst({
      where: { id, communityId }
    });
    if (!existing) return res.status(404).json({ msg: 'Release not found' });
    await prisma.release.delete({ where: { id } });
    res.status(204).send();
  })
);

export default router;
