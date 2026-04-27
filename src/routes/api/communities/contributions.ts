import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { createContributionSubmission } from '../../../modules/contribution';
import { recordContributionReport } from '../../../modules/linkHealth';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
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
import { getSettings } from '../../../modules/settings';

const router = express.Router();
const contributionIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

const reportSchema = z.object({
  reason: z.string().min(1).max(1000)
});

const approveSchema = z.object({
  approvedAccountingBytes: z
    .string()
    .regex(/^\d+$/, 'Must be a positive integer string')
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
          linkStatus: true,
          linkCheckedAt: true,
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
        linkStatus: true,
        linkCheckedAt: true,
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
    const input = parsedBody<CreateContributionInput>(res);

    const settings = await getSettings();
    if (settings.approvedDomains.length > 0) {
      let host: string;
      try {
        host = new URL(input.downloadUrl).hostname;
      } catch {
        return res.status(400).json({ msg: 'Invalid download URL' });
      }
      if (!settings.approvedDomains.includes(host)) {
        return res
          .status(400)
          .json({
            msg: `Domain '${host}' is not in the approved domains list`
          });
      }
    }

    const contribution = await createContributionSubmission({
      userId: req.user.id,
      input
    });
    if (!contribution)
      return res.status(404).json({ msg: 'Community not found' });

    res.status(201).json(contribution);
  })
);

// POST /api/contributions/:id/report — flag a dead or misleading link
router.post(
  '/:id/report',
  requireAuth,
  validateParams(contributionIdParamsSchema),
  validate(reportSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { reason } = parsedBody<{ reason: string }>(res);

    const contribution = await prisma.contribution.findUnique({
      where: { id }
    });
    if (!contribution)
      return res.status(404).json({ msg: 'Contribution not found' });

    await recordContributionReport(id, req.user.id, reason);
    res.status(201).json({ msg: 'Report submitted' });
  })
);

// PUT /api/contributions/:id/approve — staff: set approvedAccountingBytes
router.put(
  '/:id/approve',
  ...requirePermission('staff', 'admin'),
  validateParams(contributionIdParamsSchema),
  validate(approveSchema),
  asyncHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { approvedAccountingBytes } = parsedBody<{
      approvedAccountingBytes: string;
    }>(res);

    const contribution = await prisma.contribution.update({
      where: { id },
      data: { approvedAccountingBytes: BigInt(approvedAccountingBytes) },
      select: {
        id: true,
        userId: true,
        approvedAccountingBytes: true,
        linkStatus: true
      }
    });
    res.json(contribution);
  })
);

export default router;
