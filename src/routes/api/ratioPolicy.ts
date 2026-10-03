import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/permissions';
import { validate, validateParams } from '../../middleware/validate';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import {
  getPolicyState,
  overridePolicyStatus
} from '../../modules/ratioPolicy';
import { ratioPolicyOverrideSchema } from '../../schemas/ratioPolicy';

const router = Router();
const ratioPolicyOverrideBody = validate(ratioPolicyOverrideSchema);

const userIdParamsSchema = z.object({
  userId: z.coerce.number().int().positive()
});
const userIdParams = validateParams(userIdParamsSchema);

// GET /api/ratio-policy/:userId — staff: view a user's policy state
router.get(
  '/:userId',
  ...requirePermission('ratio_policy_manage'),
  userIdParams,
  asyncHandler(async (_req, res) => {
    const { userId } = userIdParams.read(res);
    const state = await getPolicyState(userId);
    res.json(state);
  })
);

// POST /api/ratio-policy/:userId/override — staff: set policy status, audited
// with a required reason (#646)
router.post(
  '/:userId/override',
  ...requirePermission('ratio_policy_manage'),
  userIdParams,
  ratioPolicyOverrideBody,
  authHandler(async (req, res) => {
    const { userId } = userIdParams.read(res);
    const state = await overridePolicyStatus(
      req.user.id,
      userId,
      ratioPolicyOverrideBody.read(res)
    );
    res.json(state);
  })
);

export default router;
