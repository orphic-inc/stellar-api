import { Router } from 'express';
import { z } from 'zod';
import { RatioPolicyStatus } from '@prisma/client';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import { asyncHandler } from '../../modules/asyncHandler';
import {
  getPolicyState,
  overridePolicyStatus
} from '../../modules/ratioPolicy';

const router = Router();

const userIdParamsSchema = z.object({
  userId: z.coerce.number().int().positive()
});

const overrideSchema = z.object({
  status: z.nativeEnum(RatioPolicyStatus)
});

// GET /api/ratio-policy/:userId — staff: view a user's policy state
router.get(
  '/:userId',
  ...requirePermission('staff', 'admin'),
  validateParams(userIdParamsSchema),
  asyncHandler(async (_req, res) => {
    const { userId } = parsedParams<{ userId: number }>(res);
    const state = await getPolicyState(userId);
    res.json(state);
  })
);

// POST /api/ratio-policy/:userId/override — staff: set policy status
router.post(
  '/:userId/override',
  ...requirePermission('staff', 'admin'),
  validateParams(userIdParamsSchema),
  validate(overrideSchema),
  asyncHandler(async (_req, res) => {
    const { userId } = parsedParams<{ userId: number }>(res);
    const { status } = parsedBody<{ status: RatioPolicyStatus }>(res);
    const state = await overridePolicyStatus(userId, status);
    res.json(state);
  })
);

export default router;
