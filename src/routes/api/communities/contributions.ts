import express from 'express';
import { z } from 'zod';
import { RatioExempt } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { sizeBytesToNumber } from '../../../lib/serialize';
import { authHandler } from '../../../modules/asyncHandler';
import {
  createContributionSubmission,
  setContributionRatioExempt
} from '../../../modules/contribution';
import { fileReport } from '../../../modules/reports';
import { recordContributionReport } from '../../../modules/linkHealth';
import { emitNotifications } from '../../../lib/notifications';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import { assertCommunityAccess } from '../../../modules/communityAccess';
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
  contributionReportSchema,
  ratioExemptSchema,
  type CreateContributionInput
} from '../../../schemas/contribution';
import { getSettings } from '../../../modules/settings';
import { authorRefSelect, toAuthorRefOrNull } from '../../../modules/authorRef';
import { renderSiteBBCode, resolveViewer } from '../../../modules/bbcodeRender';

const router = express.Router();
const contributionIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
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

// GET /api/contributions/:id — your own, or one in a community you can reach
//
// This read had no ownership check and no community check (#509 F6), which put
// it at odds with its own sibling: `GET /contributions` is
// `where: { userId: req.user.id }` — your own contributions only — while this
// route served anyone's by id. It does not expose `downloadUrl` (the list does,
// for your own rows, and grants go through `/contributions/:id/access`), but it
// does carry contributor identity, sizes, `ratioExempt`, link status and the
// release.
//
// Ownership is checked first and independently of the community. A member who
// contributed and later lost access to that community still appears in their
// own `/contributions` list, so refusing them the detail would make their own
// list link to a 403.
router.get(
  '/:id',
  requireAuth,
  validateParams(contributionIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    // Resolved ONCE for the request: the comment map below would otherwise issue
    // one identical settings query per comment (#400).
    const bbViewer = await resolveViewer(req);
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

    // `Release.communityId` is nullable, and a release with no community has no
    // membership to test — the same arm the search scope carries for exactly
    // this reason (#509 F2). Gating those would hide rows that were never
    // community-scoped at all.
    const communityId = contribution.release?.communityId ?? null;
    if (contribution.userId !== req.user.id && communityId !== null) {
      await assertCommunityAccess(communityId, req.user.id);
    }

    res.json({
      ...contribution,
      sizeInBytes: sizeBytesToNumber(contribution.sizeInBytes),
      comments: await Promise.all(
        contribution.comments.map(async (comment) => ({
          ...comment,
          author: toAuthorRefOrNull(comment.author),
          bodyHtml: await renderSiteBBCode(comment.body, bbViewer)
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
  validate(contributionReportSchema),
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
