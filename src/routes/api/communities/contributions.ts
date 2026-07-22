import express, { Request, Response } from 'express';
import { z } from 'zod';
import { RatioExempt } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { sizeBytesToNumber } from '../../../lib/serialize';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import {
  createContributionSubmission,
  setContributionRatioExempt
} from '../../../modules/contribution';
import { fileReport } from '../../../modules/reports';
import { recordContributionReport } from '../../../modules/linkHealth';
import { emitNotifications } from '../../../lib/notifications';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import {
  parsedBody,
  validate,
  validateParams,
  validateQuery,
  parsedParams
} from '../../../middleware/validate';
import {
  parsedPage,
  paginatedResponse,
  paginationBase
} from '../../../lib/pagination';
import {
  createContributionSchema,
  type CreateContributionInput
} from '../../../schemas/contribution';
import { getSettings } from '../../../modules/settings';
import { authorRefSelect, toAuthorRefOrNull } from '../../../modules/authorRef';
import { renderSiteBBCode } from '../../../modules/bbcodeRender';

const router = express.Router();
const contributionIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

const reportSchema = z.object({
  reason: z.string().min(1).max(1000)
});
const ratioExemptSchema = z.object({
  ratioExempt: z.nativeEnum(RatioExempt)
});
const contributionsQuerySchema = z.object({ ...paginationBase });

// GET /api/contributions
router.get(
  '/',
  requireAuth,
  validateQuery(contributionsQuerySchema),
  authHandler(async (req, res) => {
    const pg = parsedPage(res);
    const where = { userId: req.user.id };
    const [contributions, total] = await Promise.all([
      prisma.contribution.findMany({
        where,
        skip: pg.skip,
        take: pg.limit,
        select: {
          id: true,
          userId: true,
          releaseId: true,
          contributorId: true,
          releaseDescription: true,
          downloadUrl: true,
          sizeInBytes: true,
          approvedAccountingBytes: true,
          linkStatus: true,
          linkCheckedAt: true,
          ratioExempt: true,
          type: true,
          releaseFile: {
            select: {
              bitrate: true,
              hasLog: true,
              hasCue: true,
              isScene: true
            }
          },
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, username: true } },
          release: { select: { id: true, title: true, communityId: true } },
          collaborators: { select: { id: true, name: true } }
        }
      }),
      prisma.contribution.count({ where })
    ]);
    paginatedResponse(
      res,
      contributions.map((c) => ({
        ...c,
        sizeInBytes: sizeBytesToNumber(c.sizeInBytes)
      })),
      total,
      pg
    );
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
        ratioExempt: true,
        type: true,
        releaseFile: {
          select: { bitrate: true, hasLog: true, hasCue: true, isScene: true }
        },
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, username: true } },
        release: true,
        collaborators: true,
        comments: {
          include: {
            author: { select: authorRefSelect }
          }
        }
      }
    });
    if (!contribution)
      return res.status(404).json({ msg: 'Contribution not found' });
    res.json({
      ...contribution,
      sizeInBytes: sizeBytesToNumber(contribution.sizeInBytes),
      comments: await Promise.all(
        contribution.comments.map(async (comment) => ({
          ...comment,
          author: toAuthorRefOrNull(comment.author),
          bodyHtml: await renderSiteBBCode(comment.body)
        }))
      )
    });
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
        return res.status(400).json({
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

    const artistIds = contribution.collaborators.map((c) => c.id);
    if (artistIds.length > 0) {
      await prisma.$transaction(async (tx) => {
        const subs = await tx.artistSubscription.findMany({
          where: { artistId: { in: artistIds } },
          select: { userId: true }
        });
        const userIds = [...new Set(subs.map((s) => s.userId))];
        if (userIds.length > 0) {
          await emitNotifications(tx, {
            userIds,
            type: 'artist_release',
            actorId: req.user.id,
            page: 'contributions',
            pageId: contribution.id
          });
        }
      });
    }

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

    await fileReport(req.user.id, {
      targetType: 'Contribution',
      targetId: id,
      category: 'dead_link',
      reason
    });
    await recordContributionReport(id, req.user.id, reason);
    res.status(201).json({ msg: 'Report submitted' });
  })
);

// PUT /api/contributions/:id/ratio-exempt — staff: set/clear Freepass/Neutralpass
router.put(
  '/:id/ratio-exempt',
  ...requirePermission('contributions_manage'),
  validateParams(contributionIdParamsSchema),
  validate(ratioExemptSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { ratioExempt } = parsedBody<{ ratioExempt: RatioExempt }>(res);
    const updated = await setContributionRatioExempt(
      req.user.id,
      id,
      ratioExempt
    );
    res.json(updated);
  })
);

export default router;
