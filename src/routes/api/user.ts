import express, { Request, Response } from 'express';
import gravatar from 'gravatar';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { check, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { auth as authConfig } from '../../modules/config';
import { requireAuth } from '../../middleware/auth';

const router = express.Router();

// GET /api/users/:id — get user by id
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid user id' });

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, username: true, avatar: true, dateRegistered: true,
        isArtist: true, isDonor: true, userRank: { select: { name: true, color: true } },
        profile: true
      }
    });
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json(user);
  })
);

// POST /api/users — register
router.post(
  '/',
  [
    check('username', 'Name is required').not().isEmpty(),
    check('email', 'Please include a valid email').isEmail(),
    check('password', 'Please enter a password with 6 or more characters').isLength({ min: 6 })
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { username, email, password } = req.body as {
      username: string; email: string; password: string;
    };

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] }
    });
    if (existing) {
      return res.status(400).json({ errors: [{ msg: 'User already exists' }] });
    }

    const defaultRank = await prisma.userRank.findFirst({ where: { level: 100 } });
    if (!defaultRank) throw new Error('Default rank not found');

    const avatar = gravatar.url(email, { s: '200', r: 'pg', d: 'mm' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await prisma.$transaction(async (tx) => {
      const settings = await tx.userSettings.create({ data: {} });
      const profile = await tx.profile.create({ data: {} });
      return tx.user.create({
        data: {
          username, email, password: hashedPassword, avatar,
          userRankId: defaultRank.id,
          userSettingsId: settings.id,
          profileId: profile.id
        },
        select: { id: true, username: true, email: true, avatar: true }
      });
    });

    const payload = { user: { id: user.id } };
    jwt.sign(payload, authConfig.jwtSecret, { expiresIn: 3600 }, (err, token) => {
      if (err) throw err;
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production'
      });
      res.json({ token, user });
    });
  })
);

// GET /api/users/settings — get current user settings
router.get(
  '/settings',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const settings = await prisma.userSettings.findUnique({
      where: { user: { id: req.user!.id } } as any
    });
    res.json(settings);
  })
);

// PUT /api/users/settings — update current user settings
router.put(
  '/settings',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { siteAppearance, externalStylesheet, styledTooltips, paranoia } = req.body;
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { userSettingsId: true }
    });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const settings = await prisma.userSettings.update({
      where: { id: user.userSettingsId },
      data: {
        ...(siteAppearance !== undefined && { siteAppearance }),
        ...(externalStylesheet !== undefined && { externalStylesheet }),
        ...(styledTooltips !== undefined && { styledTooltips }),
        ...(paranoia !== undefined && { paranoia })
      }
    });
    res.json(settings);
  })
);

export default router;
