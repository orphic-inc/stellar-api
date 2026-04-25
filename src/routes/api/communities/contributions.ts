import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { createContributionSubmission } from '../../../modules/contribution';
import { requireAuth } from '../../../middleware/auth';
import {
  parsedBody,
  validate,
  validateParams,
  parsedParams
} from '../../../middleware/validate';
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
        select: {
          id: true,
          userId: true,
          releaseId: true,
          contributorId: true,
          releaseDescription: true,
          sizeInBytes: true,
          approvedAccountingBytes: true,
          type: true,
          createdAt: true,
          updatedAt: true,
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
    const { id } = parsedParams<{ id: number }>(res);
    const contribution = await prisma.contribution.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        releaseId: true,
        contributorId: true,
        releaseDescription: true,
        sizeInBytes: true,
        approvedAccountingBytes: true,
        type: true,
        createdAt: true,
        updatedAt: true,
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
  authHandler(async (req, res) => {
    const contribution = await createContributionSubmission({
      userId: req.user.id,
      input: parsedBody<CreateContributionInput>(res)
    });
    if (!contribution)
      return res.status(404).json({ msg: 'Community not found' });

    res.status(201).json(contribution);
  })
);

export default router;
