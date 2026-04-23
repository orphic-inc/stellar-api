import express, { Request, Response } from 'express';
import { FileType, ReleaseCategory, ReleaseType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { validate, validateParams } from '../../../middleware/validate';
import { parsePage, paginatedResponse } from '../../../lib/pagination';
import {
  createContributionSchema,
  type CreateContributionInput
} from '../../../schemas/contribution';

const router = express.Router();
const contributionIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/contributions
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsePage(req);
    const [contributions, total] = await Promise.all([
      prisma.contribution.findMany({
        skip: pg.skip,
        take: pg.limit,
        include: {
          user: { select: { id: true, username: true } },
          release: { select: { id: true, title: true } },
          collaborators: { select: { id: true, name: true } }
        }
      }),
      prisma.contribution.count()
    ]);
    paginatedResponse(res, contributions, total, pg);
  })
);

// GET /api/contributions/:id
router.get(
  '/:id',
  requireAuth,
  validateParams(contributionIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as unknown as { id: number };
    const contribution = await prisma.contribution.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true } },
        release: true,
        collaborators: true,
        comments: {
          include: {
            author: { select: { id: true, username: true, avatar: true } }
          }
        }
      }
    });
    if (!contribution)
      return res.status(404).json({ msg: 'Contribution not found' });
    res.json(contribution);
  })
);

// POST /api/contributions
router.post(
  '/',
  requireAuth,
  validate(createContributionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const {
      communityId,
      title,
      year,
      type,
      fileType,
      sizeInBytes,
      tags,
      image,
      description,
      releaseDescription,
      collaborators,
      jsonFile
    } = req.body as CreateContributionInput;

    const community = await prisma.community.findUnique({
      where: { id: communityId }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });

    const normalizedTags = [
      ...new Set(
        (tags ?? '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      )
    ];

    const contribution = await prisma.$transaction(async (tx) => {
      const contributor = await tx.contributor.upsert({
        where: { userId: req.user!.id },
        update: { communityId },
        create: { userId: req.user!.id, communityId }
      });

      const collaboratorRecords = [];
      for (const collaborator of collaborators) {
        const existingArtist = await tx.artist.findFirst({
          where: { name: collaborator.artist }
        });
        const artist =
          existingArtist ??
          (await tx.artist.create({
            data: { name: collaborator.artist, vanityHouse: false }
          }));
        collaboratorRecords.push(artist);
      }

      const primaryArtist = collaboratorRecords[0];
      const release = await tx.release.create({
        data: {
          artistId: primaryArtist.id,
          communityId,
          title,
          year,
          type,
          releaseType:
            type === ReleaseType.Music
              ? ReleaseCategory.Album
              : ReleaseCategory.Unknown,
          image: image ?? null,
          description: description ?? releaseDescription ?? title,
          contributors: { connect: { id: contributor.id } },
          ...(normalizedTags.length > 0 && {
            tags: {
              connectOrCreate: normalizedTags.map((tagName) => ({
                where: { name: tagName },
                create: { name: tagName }
              }))
            }
          })
        },
        include: {
          artist: true,
          tags: true
        }
      });

      return tx.contribution.create({
        data: {
          userId: req.user!.id,
          releaseId: release.id,
          contributorId: contributor.id,
          releaseDescription,
          type: fileType as FileType,
          sizeInBytes,
          jsonFile: jsonFile ?? false,
          collaborators: {
            connect: collaboratorRecords.map((artist) => ({ id: artist.id }))
          }
        },
        include: {
          user: { select: { id: true, username: true } },
          release: { select: { id: true, title: true, communityId: true } },
          collaborators: { select: { id: true, name: true } }
        }
      });
    });

    res.status(201).json(contribution);
  })
);

export default router;
