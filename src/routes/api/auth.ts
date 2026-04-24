import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import gravatar from 'gravatar';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { auth as authConfig } from '../../modules/config';
import { requireAuth } from '../../middleware/auth';
import { validate, parsedBody } from '../../middleware/validate';
import { authLimiter } from '../../middleware/rateLimiter';
import {
  loginSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput
} from '../../schemas/auth';

const router = express.Router();

const TOKEN_TTL_SECONDS = 3600; // 1 hour
const TOKEN_TTL_MS = TOKEN_TTL_SECONDS * 1000;

const issueToken = (userId: number): Promise<string> =>
  new Promise((resolve, reject) => {
    jwt.sign(
      { user: { id: userId } },
      authConfig.jwtSecret,
      { expiresIn: TOKEN_TTL_SECONDS },
      (err, token) => {
        if (err || !token)
          return reject(err ?? new Error('Token generation failed'));
        resolve(token);
      }
    );
  });

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: TOKEN_TTL_MS
};

const authUserSelect = {
  id: true,
  username: true,
  email: true,
  avatar: true,
  isArtist: true,
  isDonor: true,
  canDownload: true,
  inviteCount: true,
  dateRegistered: true,
  lastLogin: true,
  userRank: {
    select: {
      level: true,
      name: true,
      color: true,
      badge: true,
      permissions: true
    }
  }
} as const;

// POST /api/auth/logout
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token', { sameSite: 'lax', httpOnly: true });
  res.status(204).send();
});

// POST /api/auth/register — public self-registration
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { username, email, password } = parsedBody<RegisterInput>(res);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { username }] }
    });
    if (existing) {
      return res.status(400).json({ msg: 'User already exists' });
    }

    const defaultRank = await prisma.userRank.findFirst({
      where: { level: 100 }
    });
    if (!defaultRank) throw new Error('Default rank not found');

    const avatar = gravatar.url(email, { s: '200', r: 'pg', d: 'mm' });
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
          avatar,
          userRankId: defaultRank.id,
          userSettingsId: settings.id,
          profileId: profile.id
        },
        select: authUserSelect
      });
    });

    const token = await issueToken(user.id);
    res.cookie('token', token, cookieOptions);
    res.status(201).json({ user });
  })
);

// GET /api/auth — get current user profile
router.get(
  '/',
  requireAuth,
  authHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: authUserSelect
    });
    if (!user) return res.status(401).json({ msg: 'Unauthorized' });
    res.json(user);
  })
);

// POST /api/auth — login
router.post(
  '/',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = parsedBody<LoginInput>(res);

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
    if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

    if (user.disabled) return res.status(403).json({ msg: 'Account disabled' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });

    const authUser = await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
      select: authUserSelect
    });

    const token = await issueToken(user.id);
    res.cookie('token', token, cookieOptions);
    res.json({ user: authUser });
  })
);

export default router;
