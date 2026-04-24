import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import {
  getUserSettings,
  updateUserSettings,
  createUser
} from '../../modules/user';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import {
  adminCreateUserSchema,
  userSettingsSchema,
  type AdminCreateUserInput,
  type UserSettingsInput
} from '../../schemas/user';

const router = express.Router();
const userIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/users/settings — must be declared before /:id to avoid shadowing
router.get(
  '/settings',
  requireAuth,
  authHandler(async (req, res) => {
    const settings = await getUserSettings(req.user.id);
    if (!settings) return res.status(404).json({ msg: 'User not found' });
    res.json(settings);
  })
);

// PUT /api/users/settings
router.put(
  '/settings',
  requireAuth,
  validate(userSettingsSchema),
  authHandler(async (req, res) => {
    const data = parsedBody<UserSettingsInput>(res);
    const result = await updateUserSettings(req.user.id, data);
    if (!result) return res.status(404).json({ msg: 'User not found' });
    res.json(result);
  })
);

// GET /api/users/:id — get user by id (public profile)
router.get(
  '/:id',
  validateParams(userIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        avatar: true,
        dateRegistered: true,
        isArtist: true,
        isDonor: true,
        userRank: { select: { name: true, color: true } },
        profile: true
      }
    });
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json(user);
  })
);

// POST /api/users — admin creates a user account (no session issued)
router.post(
  '/',
  ...requirePermission('users_edit'),
  validate(adminCreateUserSchema),
  authHandler(async (req, res) => {
    const { username, email, password, userRankId } =
      parsedBody<AdminCreateUserInput>(res);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { username }] }
    });
    if (existing) {
      return res.status(400).json({ msg: 'User already exists' });
    }

    const user = await createUser(
      { username, email, password, userRankId },
      req.user.id
    );
    res.status(201).json(user);
  })
);

export default router;
