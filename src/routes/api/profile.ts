import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';

const router = express.Router();

// GET /api/profile/me
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true, username: true, avatar: true,
        profile: true,
        userSettings: true,
        userRank: { select: { name: true, color: true } }
      }
    });
    if (!user?.profile) return res.status(404).json({ msg: 'Profile not found' });
    res.json(user);
  })
);

// GET /api/profile — get all profiles
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const users = await prisma.user.findMany({
      select: {
        id: true, username: true, avatar: true,
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
        id: true, username: true, avatar: true, dateRegistered: true,
        isArtist: true, isDonor: true,
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
  asyncHandler(async (req: Request, res: Response) => {
    const {
      avatar, avatarMouseoverText, profileTitle, profileInfo,
      siteAppearance, externalStylesheet, styledTooltips
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
          ...(avatar !== undefined && { avatar }),
          ...(avatarMouseoverText !== undefined && { avatarMouseoverText }),
          ...(profileTitle !== undefined && { profileTitle }),
          ...(profileInfo !== undefined && { profileInfo })
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

// DELETE /api/profile — delete account
router.delete(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    await prisma.user.delete({ where: { id: req.user!.id } });
    res.clearCookie('token');
    res.json({ msg: 'User deleted' });
  })
);

export default router;
