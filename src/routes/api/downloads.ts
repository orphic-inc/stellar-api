import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import { downloadLimiter } from '../../middleware/rateLimiter';
import { validate, validateParams } from '../../middleware/validate';
import { authHandler } from '../../modules/asyncHandler';
import { contributionVisibleTo } from '../../modules/communityAccess';
import {
  grantDownloadAccess,
  reverseDownloadAccess
} from '../../modules/downloads';
import {
  grantAccessSchema,
  reverseGrantSchema,
  downloadGrantParamsSchema,
  contributionAccessParamsSchema
} from '../../schemas/downloads';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { DownloadGrantStatus } from '@prisma/client';

const router = Router();
const reverseGrantBody = validate(reverseGrantSchema);
const grantAccessBody = validate(grantAccessSchema);
const downloadGrantParams = validateParams(downloadGrantParamsSchema);
const contributionAccessParams = validateParams(contributionAccessParamsSchema);

// POST /api/contributions/:id/access — grant download access and return URL
router.post(
  '/contributions/:id/access',
  downloadLimiter,
  requireAuth,
  contributionAccessParams,
  grantAccessBody,
  authHandler(async (req, res) => {
    const { id } = contributionAccessParams.read(res);
    const { idempotencyKey } = grantAccessBody.read(res);
    const result = await grantDownloadAccess(req.user.id, id, idempotencyKey);
    res.json(result);
  })
);

// GET /api/contributions/:id/access/latest — return a recent grant if within idempotency window
router.get(
  '/contributions/:id/access/latest',
  requireAuth,
  contributionAccessParams,
  authHandler(async (req, res) => {
    const { id } = contributionAccessParams.read(res);
    const windowStart = new Date(Date.now() - 120_000);
    const grant = await prisma.downloadAccessGrant.findFirst({
      where: {
        consumerId: req.user.id,
        contributionId: id,
        status: DownloadGrantStatus.COMPLETED,
        createdAt: { gte: windowStart }
      },
      orderBy: { createdAt: 'desc' }
    });
    if (!grant) throw new AppError(404, 'No recent grant found');
    // Gated as the grant itself is (#778): a contribution the caller can no
    // longer see is not found.
    const contribution = await prisma.contribution.findFirst({
      where: { id, ...contributionVisibleTo(req.user.id) },
      select: { downloadUrl: true }
    });
    if (!contribution) throw new AppError(404, 'Contribution not found');
    res.json({
      grantId: grant.id,
      downloadUrl: contribution.downloadUrl,
      amountBytes: grant.amountBytes.toString(),
      status: grant.status,
      createdAt: grant.createdAt.toISOString()
    });
  })
);

// POST /api/downloads/:grantId/reverse — staff reversal
router.post(
  '/downloads/:grantId/reverse',
  ...requirePermission('staff', 'admin'),
  downloadGrantParams,
  reverseGrantBody,
  authHandler(async (req, res) => {
    const { grantId } = downloadGrantParams.read(res);
    const { reason } = reverseGrantBody.read(res);
    const result = await reverseDownloadAccess(req.user.id, grantId, reason);
    res.json(result);
  })
);

export default router;
