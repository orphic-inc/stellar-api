import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import gravatar from 'gravatar';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { auth as authConfig } from '../../modules/config';
import { markInstalled } from '../../modules/installState';
import { installLimiter } from '../../middleware/rateLimiter';
import { validate } from '../../middleware/validate';
import { installSchema } from '../../schemas/install';

const router = express.Router();

// Ranks seeded on first install, in level order (lowest first so default registration rank exists)
const DEFAULT_RANKS = [
  {
    level: 100,
    name: 'User',
    color: '',
    badge: '',
    permissions: {
      forums_read: true,
      forums_post: true,
    },
  },
  {
    level: 200,
    name: 'Power User',
    color: '#e2a822',
    badge: '',
    permissions: {
      forums_read: true,
      forums_post: true,
    },
  },
  {
    level: 500,
    name: 'Staff',
    color: '#e22a2a',
    badge: '',
    permissions: {
      forums_read: true,
      forums_post: true,
      forums_moderate: true,
      forums_manage: true,
      communities_manage: true,
      news_manage: true,
      invites_manage: true,
      users_edit: true,
      users_warn: true,
      users_disable: true,
      staff: true,
    },
  },
  {
    level: 1000,
    name: 'SysOp',
    color: '#a0d468',
    badge: '',
    permissions: {
      forums_read: true,
      forums_post: true,
      forums_moderate: true,
      forums_manage: true,
      communities_manage: true,
      news_manage: true,
      invites_manage: true,
      users_edit: true,
      users_warn: true,
      users_disable: true,
      staff: true,
      admin: true,
    },
  },
];

// GET /api/install — returns installation status
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const count = await prisma.userRank.count();
  res.json({ installed: count > 0 });
}));

// POST /api/install — one-time setup: seed ranks and create first SysOp user
router.post(
  '/',
  installLimiter,
  validate(installSchema),
  asyncHandler(async (req: Request, res: Response) => {

    const count = await prisma.userRank.count();
    if (count > 0) return res.status(409).json({ msg: 'Application already installed' });

    const { username, email, password } = req.body as {
      username: string; email: string; password: string;
    };

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) return res.status(400).json({ errors: [{ msg: 'User already exists' }] });

    const avatar = gravatar.url(email, { s: '200', r: 'pg', d: 'mm' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await prisma.$transaction(async (tx) => {
      let sysopRankId: number | null = null;
      for (const rank of DEFAULT_RANKS) {
        const created = await tx.userRank.create({ data: rank });
        if (rank.level === 1000) sysopRankId = created.id;
      }

      const systemCategory = await tx.forumCategory.create({ data: { name: 'System', sort: 0 } });
      await tx.forum.create({
        data: {
          forumCategoryId: systemCategory.id,
          sort: 0,
          name: 'Trash',
          description: 'Holds topics from deleted forums.',
          isTrash: true,
          minClassRead: 500,
          minClassWrite: 500,
          minClassCreate: 500
        }
      });

      const settings = await tx.userSettings.create({ data: {} });
      const profile = await tx.profile.create({ data: {} });
      return tx.user.create({
        data: {
          username,
          email,
          password: hashedPassword,
          avatar,
          userRankId: sysopRankId!,
          userSettingsId: settings.id,
          profileId: profile.id,
          inviteCount: 100,
        },
        select: { id: true, username: true, email: true, avatar: true, createdAt: true },
      });
    });

    markInstalled();

    const payload = { user: { id: user.id } };
    jwt.sign(payload, authConfig.jwtSecret, { expiresIn: 3600 }, (err, token) => {
      if (err) throw err;
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
      });
      res.status(201).json({ user, token });
    });
  })
);

export default router;
