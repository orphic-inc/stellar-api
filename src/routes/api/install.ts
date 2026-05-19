import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import gravatar from 'gravatar';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import {
  auth as authConfig,
  http as httpConfig,
  email as emailConfig
} from '../../modules/config';
import { installLimiter } from '../../middleware/rateLimiter';
import { validate, parsedBody } from '../../middleware/validate';
import { installSchema, type InstallInput } from '../../schemas/install';
import { getSettings } from '../../modules/settings';
import { seedRanks, seedForums } from '../../modules/bootstrap';
import { AppError } from '../../lib/errors';
import { authUserSelect, toAuthUser } from '../../modules/auth';

const TOKEN_TTL_SECONDS = 3600;
const STARTUP_BUFFER = 5_368_709_120n; // 5 GiB — matches self-registration buffer

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

function getConfigWarnings(): string[] {
  const warnings: string[] = [];
  if (httpConfig.corsOrigin === 'http://localhost:3000') {
    warnings.push(
      'STELLAR_HTTP_CORS_ORIGIN is not set or uses the development default. Update this to your frontend URL before going live.'
    );
  }
  if (emailConfig.siteUrl === 'http://localhost:3000') {
    warnings.push(
      'STELLAR_SITE_URL is not set or uses the development default. Update this before going live.'
    );
  }
  if (!emailConfig.smtpHost) {
    warnings.push(
      'SMTP is not configured (STELLAR_SMTP_HOST is unset). Invite emails will not be delivered.'
    );
  }
  return warnings;
}

function getSetupChecklist(settings: {
  registrationStatus: 'open' | 'invite' | 'closed';
  maxUsers: number;
  approvedDomains: string[];
}): string[] {
  const checklist: string[] = [];

  if (settings.registrationStatus === 'open') {
    checklist.push(
      'registrationStatus is still "open". Switch it to "closed" or "invite" until you are ready for public launch.'
    );
  }

  if (settings.maxUsers === 7000) {
    checklist.push(
      'maxUsers is still the default value (7000). Review and set a launch-ready capacity limit.'
    );
  }

  if (settings.approvedDomains.length === 0) {
    checklist.push(
      'approvedDomains is empty. Leave it unrestricted only if you intentionally want to allow all email domains.'
    );
  }

  return [...checklist, ...getConfigWarnings()];
}

const router = express.Router();

// GET /api/install — installation status and live environment warnings
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const [rankCount, userCount, settings] = await Promise.all([
      prisma.userRank.count(),
      prisma.user.count(),
      getSettings()
    ]);
    res.json({
      installed: rankCount > 0 && userCount > 0,
      registrationStatus: settings.registrationStatus,
      configWarnings: getConfigWarnings(),
      setupChecklist: getSetupChecklist(settings)
    });
  })
);

// POST /api/install — one-time setup: seed ranks/forums and create first SysOp
router.post(
  '/',
  installLimiter,
  validate(installSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const userCount = await prisma.user.count();
    if (userCount > 0)
      return res.status(409).json({ msg: 'Application already installed' });

    const { username, email, password } = parsedBody<InstallInput>(res);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { username }] }
    });
    if (existing) return res.status(400).json({ msg: 'User already exists' });

    // Bootstrap ranks and forums outside the user transaction so they exist
    // even if user creation fails, and so the transaction stays minimal.
    await seedRanks(prisma);
    await seedForums(prisma);

    const sysopRank = await prisma.userRank.findFirst({
      where: { level: 1000 }
    });
    if (!sysopRank)
      throw new AppError(
        500,
        'SysOp rank missing after bootstrap — run db:seed'
      );

    const avatar = gravatar.url(email, { s: '200', r: 'pg', d: 'mm' });
    const hashedPassword = await bcrypt.hash(
      password,
      await bcrypt.genSalt(10)
    );

    const rawUser = await prisma.$transaction(async (tx) => {
      const settings = await tx.userSettings.create({ data: {} });
      const profile = await tx.profile.create({ data: {} });
      return tx.user.create({
        data: {
          username,
          email: email.toLowerCase(),
          password: hashedPassword,
          avatar,
          userRankId: sysopRank.id,
          userSettingsId: settings.id,
          profileId: profile.id,
          inviteCount: 100,
          contributed: STARTUP_BUFFER
        },
        select: authUserSelect
      });
    });

    const token = await issueToken(rawUser.id);
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: TOKEN_TTL_SECONDS * 1000
    });
    res.status(201).json({ user: toAuthUser(rawUser) });
  })
);

export default router;
