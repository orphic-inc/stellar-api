import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedParams
} from '../../middleware/validate';
import {
  adminCreateUserSchema,
  userSettingsSchema,
  type AdminCreateUserInput
} from '../../schemas/user';
import { audit } from '../../lib/audit';

const router = express.Router();
const userIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/users/settings — must be declared before /:id to avoid shadowing
router.get(
  '/settings',
  requireAuth,
  authHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { userSettingsId: true }
    });
    if (!user) return res.status(404).json({ msg: 'User not found' });
    const settings = await prisma.userSettings.findUnique({
      where: { id: user.userSettingsId }
    });
    res.json(settings);
  })
);

// PUT /api/users/settings
router.put(
  '/settings',
  requireAuth,
  validate(userSettingsSchema),
  authHandler(async (req, res) => {
    const {
      siteAppearance,
      externalStylesheet,
      styledTooltips,
      paranoia,
      avatar
    } = req.body;
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { userSettingsId: true }
    });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const [settings] = await prisma.$transaction([
      prisma.userSettings.update({
        where: { id: user.userSettingsId },
        data: {
          ...(siteAppearance !== undefined && { siteAppearance }),
          ...(externalStylesheet !== undefined && { externalStylesheet }),
          ...(styledTooltips !== undefined && { styledTooltips }),
          ...(paranoia !== undefined && { paranoia })
        }
      }),
      ...(avatar !== undefined
        ? [
            prisma.user.update({
              where: { id: req.user.id },
              data: { avatar }
            })
          ]
        : [])
    ]);
    res.json({ ...settings, avatar });
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
      req.body as AdminCreateUserInput;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { username }] }
    });
    if (existing) {
      return res.status(400).json({ errors: [{ msg: 'User already exists' }] });
    }

    const rankId =
      userRankId ??
      (await prisma.userRank.findFirst({ where: { level: 100 } }))?.id;
    if (!rankId) throw new Error('Default rank not found');

    const hashedPassword = await bcrypt.hash(
      password,
      await bcrypt.genSalt(10)
    );

    const user = await prisma.$transaction(async (tx) => {
      const settings = await tx.userSettings.create({ data: {} });
      const profile = await tx.profile.create({ data: {} });
      return tx.user.create({
        data: {
          username,
          email: email.toLowerCase(),
          password: hashedPassword,
          avatar: '',
          userRankId: rankId,
          userSettingsId: settings.id,
          profileId: profile.id
        },
        select: { id: true, username: true, email: true }
      });
    });

    await audit(prisma, req.user.id, 'user.create', 'User', user.id, {
      username,
      email
    });

    // No JWT or cookie — admin-created accounts require explicit login
    res.status(201).json(user);
  })
);

export default router;
