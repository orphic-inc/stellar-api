import crypto from 'crypto';
import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  profileUpdateSchema,
  inviteSchema,
  type InviteInput
} from '../../schemas/profile';
import { sanitizeHtml, sanitizePlain } from '../../lib/sanitize';

const router = express.Router();

// GET /api/profile/me
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        username: true,
        avatar: true,
        profile: true,
        userSettings: true,
        userRank: { select: { name: true, color: true } }
      }
    });
    if (!user?.profile)
      return res.status(404).json({ msg: 'Profile not found' });
    res.json(user);
  })
);

// GET /api/profile — get all profiles
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const users = await prisma.user.findMany({
      where: { disabled: false },
      select: {
        id: true,
        username: true,
        avatar: true,
        profile: { select: { profileTitle: true } }
      }
    });
    res.json(users);
  })
);

// GET /api/profile/user/:userId
router.get(
  '/user/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ msg: 'Invalid user id' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        avatar: true,
        dateRegistered: true,
        isArtist: true,
        isDonor: true,
        userRank: { select: { name: true, color: true, badge: true } },
        profile: true,
        userSettings: { select: { siteAppearance: true, styledTooltips: true } }
      }
    });
    if (!user) return res.status(404).json({ msg: 'Profile not found' });
    res.json(user);
  })
);

// PUT /api/profile/me — update profile
router.put(
  '/me',
  requireAuth,
  validate(profileUpdateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const {
      avatar,
      avatarMouseoverText,
      profileTitle,
      profileInfo,
      siteAppearance,
      externalStylesheet,
      styledTooltips
    } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { profileId: true, userSettingsId: true }
    });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const [profile] = await prisma.$transaction([
      prisma.profile.update({
        where: { id: user.profileId },
        data: {
          ...(avatar !== undefined && { avatar: sanitizePlain(avatar) }),
          ...(avatarMouseoverText !== undefined && {
            avatarMouseoverText: sanitizePlain(avatarMouseoverText)
          }),
          ...(profileTitle !== undefined && {
            profileTitle: sanitizePlain(profileTitle)
          }),
          ...(profileInfo !== undefined && {
            profileInfo: sanitizeHtml(profileInfo)
          })
        }
      }),
      prisma.userSettings.update({
        where: { id: user.userSettingsId },
        data: {
          ...(siteAppearance !== undefined && { siteAppearance }),
          ...(externalStylesheet !== undefined && { externalStylesheet }),
          ...(styledTooltips !== undefined && { styledTooltips })
        }
      })
    ]);

    res.json(profile);
  })
);

// DELETE /api/profile — disable account (soft-delete; users are never hard-deleted)
router.delete(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { disabled: true }
    });
    res.clearCookie('token');
    res.json({ msg: 'Account disabled' });
  })
);

// POST /api/profile/referral/create-invite
router.post(
  '/referral/create-invite',
  requireAuth,
  validate(inviteSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, reason } = req.body as InviteInput;

    const inviter = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { inviteCount: true }
    });
    if (!inviter || inviter.inviteCount <= 0) {
      return res.status(403).json({ msg: 'No invites remaining' });
    }

    const existing = await prisma.invite.findUnique({ where: { email } });
    if (existing)
      return res
        .status(409)
        .json({ msg: 'An invite has already been sent to that address' });

    const inviteKey = crypto.randomBytes(20).toString('hex');
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.invite.create({
        data: {
          inviterId: req.user!.id,
          inviteKey,
          email: sanitizePlain(email),
          expires,
          reason: reason ? sanitizePlain(reason) : ''
        }
      }),
      prisma.user.update({
        where: { id: req.user!.id },
        data: { inviteCount: { decrement: 1 } }
      })
    ]);

    res.status(201).json({ msg: 'Invite sent', inviteKey });
  })
);

export default router;
