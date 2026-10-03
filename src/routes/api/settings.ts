import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import { validate } from '../../middleware/validate';
import { updateSettingsSchema } from '../../schemas/settings';
import { getSettings, updateSettings } from '../../modules/settings';
import { audit } from '../../lib/audit';

const router = express.Router();
const updateSettingsBody = validate(updateSettingsSchema);

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
  updateSettingsBody,
  authHandler(async (req, res) => {
    const input = updateSettingsBody.read(res);
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
