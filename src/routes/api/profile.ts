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
import { listOwnPendingInvites, getInviteRefusal } from '../../modules/invite';
import { inviteRefusalMsg } from '../../modules/inviteGates';
import { withdrawInvite } from '../../modules/inviteControls';
import {
  parsedPage,
  paginatedResponse,
  paginationBase
} from '../../lib/pagination';
import { getReputation, filterReputationView } from '../../modules/reputation';
import { getCrsHistory, type CrsHistoryPeriod } from '../../modules/crsHistory';
import {
  reputationHistoryPeriodQuerySchema,
  type ReputationHistoryPeriodQuery
} from '../../schemas/statsHistory';
import { getPolicyState } from '../../modules/ratioPolicy';
import { getMemberFeeds, rotateFeedToken } from '../../modules/feedToken';
import { resolveViewer } from '../../modules/bbcodeRender';
import { requireAuth } from '../../middleware/auth';
import { loadPermissions } from '../../middleware/permissions';
import { hasPermission } from '../../lib/rankPermissions';
import { audit } from '../../lib/audit';
import { z } from 'zod';
import {
  validate,
  validateParams,
  validateQuery,
  parsedBody,
  parsedParams,
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
    const user = await getProfileById(
      req.user.id,
      req.user.id,
      await resolveViewer(req)
    );
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
    const user = await getProfileByLookup(
      userId,
      req.user!.id,
      await resolveViewer(req)
    );

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

// GET /api/profile/me/feeds — your Member Feed URLs (ADR-0014, #262), or that
// feeds are not enabled here. Complete URLs, never a bare token. `no-store`:
// the body is a live credential.
router.get(
  '/me/feeds',
  requireAuth,
  authHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getMemberFeeds(req.user.id));
  })
);

// POST /api/profile/me/feed-token/rotate — revoke every feed URL you have
// handed out, and answer the new ones.
router.post(
  '/me/feed-token/rotate',
  requireAuth,
  authHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await rotateFeedToken(req.user.id, req.user.id));
  })
);

const ownInvitesQuerySchema = z.object({ ...paginationBase });
const inviteIdParamsSchema = z.object({
  inviteId: z.coerce.number().int().positive()
});

// `invites_unlimited` (ADR-0043 §5) is resolved here and passed down: the
// invite module never reads permissions.
const hasUnlimitedInvites = async (
  req: Parameters<typeof loadPermissions>[0],
  res: Response
) => hasPermission(await loadPermissions(req, res), 'invites_unlimited');

// GET /api/profile/me/invites/eligibility — can you send an invite right now,
// and if not, why (#637). Same gates and words as the send.
router.get(
  '/me/invites/eligibility',
  requireAuth,
  authHandler(async (req, res) => {
    const unlimited = await hasUnlimitedInvites(req, res);
    const reason = await getInviteRefusal(req.user.id, unlimited);
    res.json({
      canSend: reason === null,
      reason,
      msg: reason === null ? null : inviteRefusalMsg(reason, { sent: false }),
      unlimited
    });
  })
);

// GET /api/profile/me/invites — your invites that can still be used (#640)
router.get(
  '/me/invites',
  requireAuth,
  validateQuery(ownInvitesQuerySchema),
  authHandler(async (req, res) => {
    const pg = parsedPage(res);
    const { rows, total } = await listOwnPendingInvites(req.user.id, pg);
    paginatedResponse(res, rows, total, pg);
  })
);

// POST /api/profile/me/invites/:inviteId/withdraw — take back your own pending
// invite and get it refunded if it was spent (#640, #637). 404 for anyone
// else's invite.
router.post(
  '/me/invites/:inviteId/withdraw',
  requireAuth,
  validateParams(inviteIdParamsSchema),
  authHandler(async (req, res) => {
    const { inviteId } = parsedParams<{ inviteId: number }>(res);
    const { refunded } = await withdrawInvite(req.user.id, inviteId);
    res.json({
      msg: refunded
        ? 'Invite withdrawn and returned to you'
        : 'Invite withdrawn'
    });
  })
);

// PUT /api/profile/me — update profile
router.put(
  '/me',
  requireAuth,
  validate(profileUpdateSchema),
  authHandler(async (req, res) => {
    const data = parsedBody<ProfileUpdateInput>(res);
    const updated = await updateProfile(
      req.user.id,
      data,
      await resolveViewer(req)
    );
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
    // Every gate, capacity included (#624, #637), is answered inside
    // createInvite before it writes, so a refused member keeps their invite.
    const result = await createInvite(req.user.id, email, reason ?? '', {
      unlimited: await hasUnlimitedInvites(req, res)
    });
    if (!result.ok) {
      if (result.reason === 'already_invited')
        return res
          .status(409)
          .json({ msg: 'An invite has already been sent to that address' });
      return res
        .status(403)
        .json({ msg: inviteRefusalMsg(result.reason, { sent: true }) });
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
