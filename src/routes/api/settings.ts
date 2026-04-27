import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import { validate, parsedBody } from '../../middleware/validate';
import {
  updateSettingsSchema,
  type UpdateSettingsInput
} from '../../schemas/settings';
import { getSettings, updateSettings } from '../../modules/settings';
import { audit } from '../../lib/audit';

const router = express.Router();

// GET /api/settings — any authenticated user
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const settings = await getSettings();
    res.json(settings);
  })
);

// PUT /api/settings — admin only
router.put(
  '/',
  ...requirePermission('admin'),
  validate(updateSettingsSchema),
  authHandler(async (req, res) => {
    const input = parsedBody<UpdateSettingsInput>(res);
    const settings = await updateSettings(input);
    await audit(
      prisma,
      req.user.id,
      'settings.update',
      'SiteSettings',
      1,
      input
    );
    res.json(settings);
  })
);

export default router;
