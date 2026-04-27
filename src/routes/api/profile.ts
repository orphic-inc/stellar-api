import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import {
  getCurrentProfile,
  updateProfile,
  createInvite
} from '../../modules/profile';
import { getRatioStats } from '../../modules/ratio';
import { getPolicyState } from '../../modules/ratioPolicy';
import { requireAuth } from '../../middleware/auth';
import { validate, parsedBody } from '../../middleware/validate';
import {
  profileUpdateSchema,
  inviteSchema,
  type ProfileUpdateInput,
  type InviteInput
} from '../../schemas/profile';

const router = express.Router();

const PROFILE_SELECT = {
  id: true,
  username: true,
  avatar: true,
  dateRegistered: true,
  isArtist: true,
  isDonor: true,
  uploaded: true,
  downloaded: true,
  totalEarned: true,
  ratio: true,
  userRank: { select: { name: true, color: true, badge: true } },
  profile: true,
  userSettings: { select: { siteAppearance: true, styledTooltips: true } }
} as const;

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

// GET /api/profile/user/:userId — accepts numeric ID or username (case-insensitive)
router.get(
  '/user/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;

    const numericId = Number(userId);
    const isNumeric =
      !isNaN(numericId) && Number.isInteger(numericId) && numericId > 0;

    const user = isNumeric
      ? await prisma.user.findUnique({
          where: { id: numericId },
          select: PROFILE_SELECT
        })
      : await prisma.user.findFirst({
          where: { username: { equals: userId.trim(), mode: 'insensitive' } },
          select: PROFILE_SELECT
        });

    if (!user) return res.status(404).json({ msg: 'Profile not found' });
    res.json(user);
  })
);

// GET /api/profile/me/ratio — detailed ratio stats for authenticated user
router.get(
  '/me/ratio',
  requireAuth,
  authHandler(async (req, res) => {
    const [stats, policy] = await Promise.all([
      getRatioStats(req.user.id),
      getPolicyState(req.user.id)
    ]);
    res.json({ ...stats, policy });
  })
);

// PUT /api/profile/me — update profile
router.put(
  '/me',
  requireAuth,
  validate(profileUpdateSchema),
  authHandler(async (req, res) => {
    const data = parsedBody<ProfileUpdateInput>(res);
    const updated = await updateProfile(req.user.id, data);
    if (!updated) return res.status(404).json({ msg: 'User not found' });
    res.json(updated);
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
    res.status(204).send();
  })
);

// POST /api/profile/referral/create-invite
router.post(
  '/referral/create-invite',
  requireAuth,
  validate(inviteSchema),
  authHandler(async (req, res) => {
    const { email, reason } = parsedBody<InviteInput>(res);
    const result = await createInvite(req.user.id, email, reason ?? '');
    if (!result.ok) {
      if (result.reason === 'no_invites')
        return res.status(403).json({ msg: 'No invites remaining' });
      return res
        .status(409)
        .json({ msg: 'An invite has already been sent to that address' });
    }
    res.status(201).json({ inviteKey: result.inviteKey });
  })
);

export default router;
