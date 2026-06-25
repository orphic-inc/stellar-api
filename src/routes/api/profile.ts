import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import {
  getProfileById,
  getProfileByLookup,
  updateProfile,
  createInvite
} from '../../modules/profile';
import { getRatioStats } from '../../modules/ratio';
import { getReputation, filterReputationView } from '../../modules/reputation';
import { getCrsHistory, type CrsHistoryPeriod } from '../../modules/crsHistory';
import {
  reputationHistoryPeriodQuerySchema,
  type ReputationHistoryPeriodQuery
} from '../../schemas/statsHistory';
import { getPolicyState } from '../../modules/ratioPolicy';
import { requireAuth } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import {
  validate,
  validateQuery,
  parsedBody,
  parsedQuery
} from '../../middleware/validate';
import {
  profileUpdateSchema,
  inviteSchema,
  donorRewardUpdateSchema,
  donorForumTitleUpdateSchema,
  type ProfileUpdateInput,
  type InviteInput,
  type DonorRewardUpdateInput,
  type DonorForumTitleUpdateInput
} from '../../schemas/profile';
import {
  getDonorSettings,
  updateDonorRewards,
  updateDonorForumTitle
} from '../../modules/donor';

const router = express.Router();
// GET /api/profile/me
router.get(
  '/me',
  requireAuth,
  authHandler(async (req, res) => {
    const user = await getProfileById(req.user.id, req.user.id);
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
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const user = await getProfileByLookup(userId, req.user!.id);

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

// GET /api/profile/me/reputation — Community Reputation Score (PRD-01), computed on read
router.get(
  '/me/reputation',
  requireAuth,
  authHandler(async (req, res) => {
    // Self-view: the member sees their own snatch-derived dimensions but NOT the
    // moderation-only Contagion drag / suspect flag (ADR-0004 §3).
    const crs = await getReputation(req.user.id);
    res.json(
      filterReputationView(crs, {
        includeSnatchDerived: true,
        includeModeration: false
      })
    );
  })
);

// GET /api/profile/me/reputation/history — CRS over time (#94). The score is
// still computed-on-read; this reads the captured trend series.
// ?period=Daily|Monthly|Yearly.
router.get(
  '/me/reputation/history',
  requireAuth,
  validateQuery(reputationHistoryPeriodQuerySchema),
  authHandler(async (req, res) => {
    const { period } = parsedQuery<ReputationHistoryPeriodQuery>(res);
    res.json(await getCrsHistory(req.user.id, period as CrsHistoryPeriod));
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
    await audit(prisma, req.user.id, 'profile.update', 'User', req.user.id, {
      fields: Object.keys(data).sort()
    });
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
    await audit(
      prisma,
      req.user.id,
      'profile.disable_self',
      'User',
      req.user.id
    );
    res.clearCookie('token');
    res.status(204).send();
  })
);

// GET /api/profile/me/donor-rewards
router.get(
  '/me/donor-rewards',
  requireAuth,
  authHandler(async (req, res) => {
    const settings = await getDonorSettings(req.user.id);
    if (!settings) return res.status(404).json({ msg: 'No active donor rank' });
    res.json(settings);
  })
);

// PUT /api/profile/me/donor-rewards
router.put(
  '/me/donor-rewards',
  requireAuth,
  validate(donorRewardUpdateSchema),
  authHandler(async (req, res) => {
    const fields = parsedBody<DonorRewardUpdateInput>(res);
    const settings = await updateDonorRewards(req.user.id, fields);
    res.json(settings);
  })
);

// PUT /api/profile/me/donor-title
router.put(
  '/me/donor-title',
  requireAuth,
  validate(donorForumTitleUpdateSchema),
  authHandler(async (req, res) => {
    const data = parsedBody<DonorForumTitleUpdateInput>(res);
    const title = await updateDonorForumTitle(req.user.id, data);
    res.json(title);
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
    await audit(
      prisma,
      req.user.id,
      'profile.invite.create',
      'Invite',
      undefined,
      { email: email.toLowerCase() }
    );
    res
      .status(201)
      .json({ inviteKey: result.inviteKey, emailSent: result.emailSent });
  })
);

export default router;
