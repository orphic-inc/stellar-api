import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import {
  grantDownloadAccess,
  reverseDownloadAccess
} from '../../modules/downloads';
import {
  grantAccessSchema,
  reverseGrantSchema,
  downloadGrantParamsSchema,
  contributionAccessParamsSchema,
  type GrantAccessInput,
  type ReverseGrantInput
} from '../../schemas/downloads';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { DownloadGrantStatus } from '@prisma/client';

const router = Router();

// POST /api/contributions/:id/access — grant download access and return URL
router.post(
  '/contributions/:id/access',
  requireAuth,
  validateParams(contributionAccessParamsSchema),
  validate(grantAccessSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { idempotencyKey } = parsedBody<GrantAccessInput>(res);
    const result = await grantDownloadAccess(req.user.id, id, idempotencyKey);
    res.json(result);
  })
);

// GET /api/contributions/:id/access/latest — return a recent grant if within idempotency window
router.get(
  '/contributions/:id/access/latest',
  requireAuth,
  validateParams(contributionAccessParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
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
    const contribution = await prisma.contribution.findUnique({
      where: { id },
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
  validateParams(downloadGrantParamsSchema),
  validate(reverseGrantSchema),
  authHandler(async (req, res) => {
    const { grantId } = parsedParams<{ grantId: number }>(res);
    const { reason } = parsedBody<ReverseGrantInput>(res);
    const result = await reverseDownloadAccess(req.user.id, grantId, reason);
    res.json(result);
  })
);

export default router;
