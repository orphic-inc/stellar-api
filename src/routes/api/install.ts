import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import {
  auth as authConfig,
  http as httpConfig,
  email as emailConfig
} from '../../modules/config';
import { installLimiter } from '../../middleware/rateLimiter';
import { requirePermission } from '../../middleware/permissions';
import { validate, parsedBody } from '../../middleware/validate';
import { installSchema, type InstallInput } from '../../schemas/install';
import { getSettings, markInstalled } from '../../modules/settings';
import {
  seedRanks,
  seedRankPromotionRules,
  seedForums,
  seedSystemUser,
  seedDefaultCommunity
} from '../../modules/bootstrap';
import { seedGoldenRules } from '../../modules/goldenRules';
import { seedStylesheetFixtures } from '../../modules/stylesheetFixtures';
import { seedWikiFixtures } from '../../modules/wikiFixtures';
import { AppError } from '../../lib/errors';
import { authUserSelect, toAuthUser } from '../../modules/auth';
import { getDefaultStylesheetName } from '../../modules/stylesheet';

const TOKEN_TTL_SECONDS = 3600;
const STARTUP_BUFFER = 5_368_709_120n; // 5 GiB — matches self-registration buffer

export type LaunchChecklistItem = {
  id: string;
  message: string;
};

type SettingsWithDismissals = Awaited<ReturnType<typeof getSettings>> & {
  dismissedLaunchChecklist?: string[];
};

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

function getConfigWarnings(): LaunchChecklistItem[] {
  const warnings: LaunchChecklistItem[] = [];
  if (httpConfig.corsOrigin === 'http://localhost:3000') {
    warnings.push({
      id: 'cors-origin-default',
      message:
        'STELLAR_HTTP_CORS_ORIGIN is not set or uses the development default. Update this to your frontend URL before going live.'
    });
  }
  if (emailConfig.siteUrl === 'http://localhost:3000') {
    warnings.push({
      id: 'site-url-default',
      message:
        'STELLAR_SITE_URL is not set or uses the development default. Update this before going live.'
    });
  }
  if (!emailConfig.smtpHost) {
    warnings.push({
      id: 'smtp-host-unset',
      message:
        'SMTP is not configured (STELLAR_SMTP_HOST is unset). Invite emails will not be delivered.'
    });
  }
  return warnings;
}

function getSetupChecklist(
  settings: SettingsWithDismissals
): LaunchChecklistItem[] {
  const dismissed = new Set(settings.dismissedLaunchChecklist ?? []);
  const checklist: LaunchChecklistItem[] = [];

  if (settings.registrationStatus === 'closed') {
    checklist.push({
      id: 'registration-closed',
      message:
        'registrationStatus is "closed". Switch it to "open" or "invite" when you are ready to accept registrations.'
    });
  }

  if (settings.maxUsers === 7000) {
    checklist.push({
      id: 'max-users-default',
      message:
        'maxUsers is still the default value (7000). Review and set a launch-ready capacity limit.'
    });
  }

  if (settings.approvedDomains.length === 0) {
    checklist.push({
      id: 'approved-domains-empty',
      message:
        'approvedDomains is empty. Leave it unrestricted only if you intentionally want to allow all email domains.'
    });
  }

  return [...checklist, ...getConfigWarnings()].filter(
    (item) => !dismissed.has(item.id)
  );
}

const router = express.Router();

// GET /api/install — installation status and live environment warnings
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const settings = await getSettings();
    res.json({
      installed: settings.installedAt != null,
      registrationStatus: settings.registrationStatus,
      configWarnings: getConfigWarnings().map((item) => item.message),
      setupChecklist: getSetupChecklist(settings as SettingsWithDismissals)
    });
  })
);

router.post(
  '/checklist/:id/dismiss',
  ...requirePermission('staff'),
  authHandler(async (req, res) => {
    const settings = (await getSettings()) as SettingsWithDismissals;
    const itemId = req.params.id;
    const dismissedLaunchChecklist = Array.from(
      new Set([...(settings.dismissedLaunchChecklist ?? []), itemId])
    );
    await prisma.siteSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        approvedDomains: settings.approvedDomains,
        registrationStatus: settings.registrationStatus,
        maxUsers: settings.maxUsers,
        dismissedLaunchChecklist
      } as never,
      update: { dismissedLaunchChecklist } as never
    });
    res.status(204).send();
  })
);

// POST /api/install — one-time setup: seed ranks/forums and create first SysOp
router.post(
  '/',
  installLimiter,
  validate(installSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const settings = await getSettings();
    if (settings.installedAt != null)
      return res.status(409).json({ msg: 'Application already installed' });

    const { username, email, password } = parsedBody<InstallInput>(res);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { username }] }
    });
    if (existing) return res.status(400).json({ msg: 'User already exists' });

    // Bootstrap ranks and forums outside the user transaction so they exist
    // even if user creation fails, and so the transaction stays minimal.
    await seedRanks(prisma);
    await seedRankPromotionRules(prisma);
    await seedForums(prisma);
    await seedGoldenRules(prisma);
    // System user + built-in stylesheet fixtures it owns (repoints the registry
    // rows at the /css delivery route). Needs ranks; independent of the SysOp.
    const systemUserId = await seedSystemUser(prisma);
    await seedStylesheetFixtures(prisma, systemUserId);
    // Also System-owned: the wiki pages the seeded Golden Rules link to (#126).
    await seedWikiFixtures(prisma, systemUserId);

    const sysopRank = await prisma.userRank.findFirst({
      where: { level: 1000 }
    });
    if (!sysopRank)
      throw new AppError(
        500,
        'SysOp rank missing after bootstrap — run db:seed'
      );

    const hashedPassword = await bcrypt.hash(
      password,
      await bcrypt.genSalt(10)
    );

    const rawUser = await prisma.$transaction(async (tx) => {
      const defaultTheme = await getDefaultStylesheetName(tx);
      const userSettings = await tx.userSettings.create({
        data: { siteAppearance: defaultTheme }
      });
      const profile = await tx.profile.create({ data: {} });
      const user = await tx.user.create({
        data: {
          username,
          email: email.toLowerCase(),
          password: hashedPassword,
          // avatar left null — UI falls back to the bundled default avatar.
          userRankId: sysopRank.id,
          userSettingsId: userSettings.id,
          profileId: profile.id,
          inviteCount: 100,
          contributed: STARTUP_BUFFER
        },
        select: authUserSelect
      });
      // Stamp install state in the same transaction: installedAt commits iff the
      // SysOp does, so the barrier can never report installed without an owner.
      await markInstalled(tx);
      return user;
    });

    // Flagship community (named after the site) owned by the SysOp — needs the
    // user to exist, so it runs after the user transaction commits.
    await seedDefaultCommunity(prisma, rawUser.id);

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
