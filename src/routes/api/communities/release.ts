import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedParams,
  parsedBody
} from '../../../middleware/validate';
import {
  createGroupSchema,
  updateGroupSchema,
  type CreateGroupInput,
  type UpdateGroupInput
} from '../../../schemas/community';
import {
  addContributionToReleaseSchema,
  type AddContributionToReleaseInput
} from '../../../schemas/contribution';
import { addContributionToRelease } from '../../../modules/contribution';
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
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId } = parsedParams<{ communityId: number }>(res);
    const pg = parsePage(req);
    const [releases, total] = await Promise.all([
      prisma.release.findMany({
        where: { communityId },
        skip: pg.skip,
        take: pg.limit,
        include: {
          artist: { select: { id: true, name: true } },
          tags: true
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
  asyncHandler(async (req: Request, res: Response) => {
    const { communityId, releaseId: id } = parsedParams<{
      communityId: number;
      releaseId: number;
    }>(res);
    const release = await prisma.release.findFirst({
      where: { id, communityId },
      include: {
        artist: true,
        tags: true,
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
    });
    if (!release) return res.status(404).json({ msg: 'Release not found' });
    res.json(release);
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
