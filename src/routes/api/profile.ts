import crypto from 'crypto';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { getCurrentProfile } from '../../modules/profile';
import { requireAuth } from '../../middleware/auth';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import {
  profileUpdateSchema,
  inviteSchema,
  type ProfileUpdateInput,
  type InviteInput
} from '../../schemas/profile';
import { sanitizeHtml, sanitizePlain } from '../../lib/sanitize';

const router = express.Router();
const userIdParamsSchema = z.object({
  userId: z.coerce.number().int().positive()
});

// GET /api/profile/me
router.get(
  '/me',
  requireAuth,
  authHandler(async (req, res) => {
    const user = await getCurrentProfile(req.user.id);
    if (!user) return res.status(404).json({ msg: 'Profile not found' });
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
  validateParams(userIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = parsedParams<{ userId: number }>(res);

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
  authHandler(async (req, res) => {
    const {
      avatar,
      avatarMouseoverText,
      profileTitle,
      profileInfo,
      siteAppearance,
      externalStylesheet,
      styledTooltips
    } = parsedBody<ProfileUpdateInput>(res);

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { profileId: true, userSettingsId: true }
    });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    await prisma.$transaction([
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

    const updatedUser = await getCurrentProfile(req.user.id);
    if (!updatedUser) return res.status(404).json({ msg: 'Profile not found' });

    res.json(updatedUser);
  })
);

// DELETE /api/profile — disable account (soft-delete; users are never hard-deleted)
router.delete(
  '/',
  requireAuth,
  authHandler(async (req, res) => {
    await prisma.user.update({
      where: { id: req.user.id },
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
  authHandler(async (req, res) => {
    const { email, reason } = parsedBody<InviteInput>(res);

    const inviter = await prisma.user.findUnique({
      where: { id: req.user.id },
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
          inviterId: req.user.id,
          inviteKey,
          email: sanitizePlain(email),
          expires,
          reason: reason ? sanitizePlain(reason) : ''
        }
      }),
      prisma.user.update({
        where: { id: req.user.id },
        data: { inviteCount: { decrement: 1 } }
      })
    ]);

    res.status(201).json({ msg: 'Invite sent', inviteKey });
  })
);

export default router;
