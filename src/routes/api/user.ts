import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import {
  getUserSettings,
  updateUserSettings,
  createUser,
  getSnatchList,
  getInviteTree,
  getMemberInviteTreeView,
  getDuplicateIps,
  warnUser,
  deleteWarning,
  setUserRank,
  grantDonorStatus,
  getUserIpHistory,
  updateStaffBio
} from '../../modules/user';
import {
  generateRecoveryToken,
  persistRecoveryToken
} from '../../modules/auth';
import { requireAuth } from '../../middleware/auth';
import { requireServiceKey } from '../../middleware/serviceAuth';
import { getReputation } from '../../modules/reputation';
import {
  requirePermission,
  loadPermissions,
  hasPermission
} from '../../middleware/permissions';
import {
  validate,
  validateParams,
  validateQuery,
  parsedBody,
  parsedParams,
  parsedQuery
} from '../../middleware/validate';
import { Prisma, StatSnapshotPeriod, RatioPolicyStatus } from '@prisma/client';
import {
  adminCreateUserSchema,
  userSettingsSchema,
  warnUserSchema,
  moderationNoteSchema,
  setRankSchema,
  rankLockSchema,
  donorRankSchema,
  grantDonorSchema,
  ircNickVerifySchema,
  type AdminCreateUserInput,
  type UserSettingsInput,
  type WarnUserInput,
  type ModerationNoteInput,
  type SetRankInput,
  type RankLockInput,
  type DonorRankInput,
  type GrantDonorInput,
  type IrcNickVerifyInput
} from '../../schemas/user';
import {
  claimIrcNick,
  clearIrcNick,
  verifyIrcNick
} from '../../modules/ircNick';
import { audit } from '../../lib/audit';
import {
  parsedPage,
  paginatedResponse,
  paginationBase
} from '../../lib/pagination';
import { sendRecoveryEmail } from '../../lib/mailer';
import { email as emailConfig } from '../../modules/config';
import {
  statsPeriodQuerySchema,
  type StatsPeriodQuery
} from '../../schemas/statsHistory';
import { getUserStatHistory } from '../../modules/statsHistory';

const router = express.Router();
const userIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});
const rankIdParamsSchema = z.object({
  rankId: z.coerce.number().int().positive()
});
const noteParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  noteId: z.coerce.number().int().positive()
});
const warningParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  warnId: z.coerce.number().int().positive()
});
const reqIdParamsSchema = z.object({
  reqId: z.coerce.number().int().positive()
});
const warningsQuerySchema = z.object({
  ...paginationBase,
  userId: z.coerce.number().int().positive().optional()
});
type WarningsQuery = z.infer<typeof warningsQuerySchema>;

const recoveryRequestsQuerySchema = z.object({
  ...paginationBase,
  status: z.enum(['pending', 'used', 'expired']).optional().default('pending')
});
type RecoveryRequestsQuery = z.infer<typeof recoveryRequestsQuerySchema>;

const inviteTreeQuerySchema = z.object({ ...paginationBase });
const ratioWatchQuerySchema = z.object({ ...paginationBase });
const registrationLogQuerySchema = z.object({ ...paginationBase });

// ─── Donor ranks (static paths — must come before /:id) ──────────────────────

// GET /api/users/donor-ranks
router.get(
  '/donor-ranks',
  requireAuth,
  authHandler(async (_req, res) => {
    const ranks = await prisma.donorRank.findMany({
      orderBy: { minDonation: 'asc' }
    });
    res.json(ranks);
  })
);

// POST /api/users/donor-ranks
router.post(
  '/donor-ranks',
  ...requirePermission('donor_ranks_manage'),
  validate(donorRankSchema),
  authHandler(async (_req, res) => {
    const { name, minDonation, expiresAfterDays, perks, color, badge } =
      parsedBody<DonorRankInput>(res);
    const rank = await prisma.donorRank.create({
      data: {
        name,
        minDonation,
        ...(expiresAfterDays !== undefined && { expiresAfterDays }),
        ...(perks !== undefined && { perks: perks as Prisma.InputJsonValue }),
        ...(color !== undefined && { color }),
        ...(badge !== undefined && { badge })
      }
    });
    res.status(201).json(rank);
  })
);

// PUT /api/users/donor-ranks/:rankId
router.put(
  '/donor-ranks/:rankId',
  ...requirePermission('donor_ranks_manage'),
  validateParams(rankIdParamsSchema),
  validate(donorRankSchema),
  authHandler(async (_req, res) => {
    const { rankId } = parsedParams<{ rankId: number }>(res);
    const { name, minDonation, expiresAfterDays, perks, color, badge } =
      parsedBody<DonorRankInput>(res);
    const existing = await prisma.donorRank.findUnique({
      where: { id: rankId }
    });
    if (!existing) return res.status(404).json({ msg: 'Donor rank not found' });
    const rank = await prisma.donorRank.update({
      where: { id: rankId },
      data: {
        name,
        minDonation,
        ...(expiresAfterDays !== undefined && { expiresAfterDays }),
        ...(perks !== undefined && { perks: perks as Prisma.InputJsonValue }),
        ...(color !== undefined && { color }),
        ...(badge !== undefined && { badge })
      }
    });
    res.json(rank);
  })
);

// DELETE /api/users/donor-ranks/:rankId
router.delete(
  '/donor-ranks/:rankId',
  ...requirePermission('donor_ranks_manage'),
  validateParams(rankIdParamsSchema),
  authHandler(async (_req, res) => {
    const { rankId } = parsedParams<{ rankId: number }>(res);
    const existing = await prisma.donorRank.findUnique({
      where: { id: rankId }
    });
    if (!existing) return res.status(404).json({ msg: 'Donor rank not found' });
    await prisma.donorRank.delete({ where: { id: rankId } });
    res.status(204).send();
  })
);

// GET /api/users/me/snatch-list (must be before /:id)
router.get(
  '/me/snatch-list',
  requireAuth,
  authHandler(async (req, res) => {
    const items = await getSnatchList(req.user.id);
    res.json(items);
  })
);

// GET /api/users/settings — must be declared before /:id to avoid shadowing
router.get(
  '/settings',
  requireAuth,
  authHandler(async (req, res) => {
    const settings = await getUserSettings(req.user.id);
    if (!settings) return res.status(404).json({ msg: 'User not found' });
    res.json(settings);
  })
);

// PUT /api/users/settings
router.put(
  '/settings',
  requireAuth,
  validate(userSettingsSchema),
  authHandler(async (req, res) => {
    const data = parsedBody<UserSettingsInput>(res);
    const result = await updateUserSettings(req.user.id, data);
    if (!result) return res.status(404).json({ msg: 'User not found' });
    res.json(result);
  })
);

// ─── korin.pink service endpoints (ADR-0013 contract) ───────────────────────
// Service-key gated (Bearer STELLAR_SERVICE_KEY). Static path → before /:id.

// GET /api/users/by-irc-nick/:nick — resolve an IRC nick to its Stellar account
const ircNickParamsSchema = z.object({ nick: z.string().min(1).max(30) });
router.get(
  '/by-irc-nick/:nick',
  requireServiceKey,
  validateParams(ircNickParamsSchema),
  asyncHandler(async (_req, res) => {
    const { nick } = parsedParams<{ nick: string }>(res);
    const user = await prisma.user.findUnique({
      where: { ircNick: nick },
      select: { id: true, username: true, ircNick: true, disabled: true }
    });
    if (!user || user.disabled) {
      return res
        .status(404)
        .json({ msg: 'No account linked to that IRC nick' });
    }
    res.json({ id: user.id, username: user.username, ircNick: user.ircNick });
  })
);

// POST /api/users/irc-nick/verify — complete a Nick Verification (ADR-0015).
// korin relays the authenticated IRC sender nick + the Verification Code it
// received over a private query. Always 200 — { verified, reason } is a
// verification *result* the bot relays, not an HTTP error. Static path → before /:id.
router.post(
  '/irc-nick/verify',
  requireServiceKey,
  validate(ircNickVerifySchema),
  asyncHandler(async (_req, res) => {
    const { nick, code } = parsedBody<IrcNickVerifyInput>(res);
    const result = await verifyIrcNick(nick, code);
    res.json(result);
  })
);

// ─── Staff recovery tools (static paths — must be before /:id) ───────────────

// GET /api/users/recovery-requests
router.get(
  '/recovery-requests',
  ...requirePermission('recovery_manage'),
  validateQuery(recoveryRequestsQuerySchema),
  authHandler(async (req, res) => {
    const { status } = parsedQuery<RecoveryRequestsQuery>(res);
    const pg = parsedPage(res);

    const now = new Date();
    const where =
      status === 'pending'
        ? { usedAt: null, expiresAt: { gt: now } }
        : status === 'used'
        ? { usedAt: { not: null } }
        : { usedAt: null, expiresAt: { lte: now } };
    const [records, total] = await Promise.all([
      prisma.accountRecovery.findMany({
        where,
        include: { user: { select: { username: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: pg.skip,
        take: pg.limit
      }),
      prisma.accountRecovery.count({ where })
    ]);

    const data = records.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.user.username,
      email: r.user.email,
      status,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      usedAt: r.usedAt
    }));

    paginatedResponse(res, data, total, pg);
  })
);

// DELETE /api/users/recovery-requests/:reqId
router.delete(
  '/recovery-requests/:reqId',
  ...requirePermission('recovery_manage'),
  validateParams(reqIdParamsSchema),
  authHandler(async (req, res) => {
    const { reqId } = parsedParams<{ reqId: number }>(res);
    const record = await prisma.accountRecovery.findUnique({
      where: { id: reqId }
    });
    if (!record)
      return res.status(404).json({ msg: 'Recovery request not found' });
    if (record.usedAt)
      return res
        .status(409)
        .json({ msg: 'Cannot revoke a used recovery token' });
    await prisma.accountRecovery.delete({ where: { id: reqId } });
    await audit(
      prisma,
      req.user.id,
      'recovery.revoked',
      'AccountRecovery',
      reqId
    );
    res.json({ msg: 'Recovery request revoked' });
  })
);

// ─── Login Watch / Invite Pool / Invite Tree / Ratio Watch (static — before /:id) ───

const sessionsQuerySchema = z.object({
  ...paginationBase,
  userId: z.coerce.number().int().positive().optional()
});
type SessionsQuery = z.infer<typeof sessionsQuerySchema>;

// GET /api/users/sessions — login watch (must be before /:id)
router.get(
  '/sessions',
  ...requirePermission('login_watch_view'),
  validateQuery(sessionsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsedPage(res);
    const { userId } = parsedQuery<SessionsQuery>(res);
    const where = userId ? { userId } : {};
    const [sessions, total] = await Promise.all([
      prisma.userSession.findMany({
        where,
        include: { user: { select: { id: true, username: true } } },
        orderBy: { createdAt: 'desc' },
        skip: pg.skip,
        take: pg.limit
      }),
      prisma.userSession.count({ where })
    ]);
    paginatedResponse(res, sessions, total, pg);
  })
);

const invitesQuerySchema = z.object({
  ...paginationBase,
  status: z.string().optional()
});
type InvitesQuery = z.infer<typeof invitesQuerySchema>;

// GET /api/users/invites — invite pool (must be before /:id)
router.get(
  '/invites',
  ...requirePermission('invites_manage'),
  validateQuery(invitesQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsedPage(res);
    const { status } = parsedQuery<InvitesQuery>(res);
    const where = status ? { status: status as never } : {};
    const [invites, total] = await Promise.all([
      prisma.invite.findMany({
        where,
        include: { inviter: { select: { id: true, username: true } } },
        orderBy: { expires: 'desc' },
        skip: pg.skip,
        take: pg.limit
      }),
      prisma.invite.count({ where })
    ]);
    const safe = invites.map(({ inviteKey: _k, ...rest }) => rest);
    paginatedResponse(res, safe, total, pg);
  })
);

// GET /api/users/invite-tree — site-wide invite tree (must be before /:id)
router.get(
  '/invite-tree',
  ...requirePermission('invites_manage'),
  validateQuery(inviteTreeQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsedPage(res);
    const { rows, total } = await getInviteTree(pg);
    paginatedResponse(res, rows, total, pg);
  })
);

// GET /api/users/:id/invite-tree — a member's invite subtree + summary.
// Own tree, or any tree with the invites-manage permission (which also lifts
// the per-member paranoia gate for moderation).
router.get(
  '/:id/invite-tree',
  requireAuth,
  validateParams(userIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const isOwner = req.user.id === id;
    const canManage = hasPermission(
      await loadPermissions(req, res),
      'invites_manage'
    );
    if (!isOwner && !canManage) {
      throw new AppError(403, 'Forbidden');
    }
    const view = await getMemberInviteTreeView(id, canManage);
    res.json(view);
  })
);

// GET /api/users/ratio-watch — users on ratio watch or leech-disabled (must be before /:id)
router.get(
  '/ratio-watch',
  ...requirePermission('ratio_policy_manage'),
  validateQuery(ratioWatchQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsedPage(res);
    const where = {
      status: {
        in: [RatioPolicyStatus.WATCH, RatioPolicyStatus.LEECH_DISABLED]
      }
    };
    const [entries, total] = await Promise.all([
      prisma.ratioPolicyState.findMany({
        where,
        include: { user: { select: { id: true, username: true } } },
        orderBy: { watchStartedAt: 'desc' },
        skip: pg.skip,
        take: pg.limit
      }),
      prisma.ratioPolicyState.count({ where })
    ]);
    paginatedResponse(res, entries, total, pg);
  })
);

// GET /api/users/warnings — site-wide staff warning log (must be before /:id)
router.get(
  '/warnings',
  ...requirePermission('admin'),
  validateQuery(warningsQuerySchema),
  authHandler(async (req, res) => {
    const pg = parsedPage(res);
    const { userId } = parsedQuery<WarningsQuery>(res);
    const where = userId ? { userId } : {};
    const [warnings, total] = await Promise.all([
      prisma.userWarning.findMany({
        where,
        include: {
          user: { select: { id: true, username: true } },
          warnedBy: { select: { id: true, username: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: pg.skip,
        take: pg.limit
      }),
      prisma.userWarning.count({ where })
    ]);
    paginatedResponse(res, warnings, total, pg);
  })
);

// GET /api/users/duplicate-ips — users sharing the same last-seen IP (must be before /:id)
router.get(
  '/duplicate-ips',
  ...requirePermission('duplicate_ips_view'),
  authHandler(async (_req, res) => {
    const result = await getDuplicateIps();
    res.json(result);
  })
);

// GET /api/users/registration-log — users ordered by registration date (must be before /:id)
router.get(
  '/registration-log',
  ...requirePermission('registration_log_view'),
  validateQuery(registrationLogQuerySchema),
  authHandler(async (req, res) => {
    const pg = parsedPage(res);
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        orderBy: { dateRegistered: 'desc' },
        skip: pg.skip,
        take: pg.limit,
        select: {
          id: true,
          username: true,
          email: true,
          dateRegistered: true,
          disabled: true,
          lastIp: true,
          userRank: { select: { id: true, name: true } }
        }
      }),
      prisma.user.count()
    ]);
    paginatedResponse(res, users, total, pg);
  })
);

// GET /api/users/:id/stats/history — user historical stats (own or staff)
router.get(
  '/:id/stats/history',
  requireAuth,
  validateParams(userIdParamsSchema),
  validateQuery(statsPeriodQuerySchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { period } = parsedQuery<StatsPeriodQuery>(res);
    const isStaff = hasPermission(await loadPermissions(req, res), 'staff');
    const userAndSettings = await prisma.user.findUnique({
      where: { id },
      include: { userSettings: true }
    });
    if (!userAndSettings)
      return res.status(404).json({ msg: 'User not found' });
    const history = await getUserStatHistory(
      id,
      period as StatSnapshotPeriod,
      req.user.id,
      isStaff,
      userAndSettings
    );
    res.json(history);
  })
);

// GET /api/users/:id — get user by id (public profile)
router.get(
  '/:id',
  validateParams(userIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        avatar: true,
        dateRegistered: true,
        isArtist: true,
        isDonor: true,
        userRank: { select: { name: true, color: true } },
        profile: true
      }
    });
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json(user);
  })
);

// POST /api/users — admin creates a user account (no session issued)
router.post(
  '/',
  ...requirePermission('users_edit'),
  validate(adminCreateUserSchema),
  authHandler(async (req, res) => {
    const { username, email, password, userRankId } =
      parsedBody<AdminCreateUserInput>(res);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { username }] }
    });
    if (existing) {
      return res.status(400).json({ msg: 'User already exists' });
    }

    const user = await createUser(
      { username, email, password, userRankId },
      req.user.id
    );
    res.status(201).json(user);
  })
);

// ─── User moderation routes (after /:id) ─────────────────────────────────────

const staffBioSchema = z.object({
  staffBio: z.string().max(500).nullable()
});

// PUT /api/users/:id/staff-bio — set staff page bio
// Allows admins to edit any user, and staff-displayed users to edit their own.
router.put(
  '/:id/staff-bio',
  requireAuth,
  validateParams(userIdParamsSchema),
  validate(staffBioSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { staffBio } = parsedBody<{ staffBio: string | null }>(res);

    const perms = await loadPermissions(req, res);
    const isAdmin = !!perms['admin'];
    const isSelf = req.user.id === id;

    if (!isAdmin && !isSelf) {
      return res.status(403).json({ msg: 'Permission denied' });
    }

    await updateStaffBio(
      id,
      staffBio,
      req.user.id,
      req.user.userRankId,
      isAdmin
    );
    res.json({ msg: 'Staff bio updated' });
  })
);

// POST /api/users/:id/recovery — admin-triggered recovery email
router.post(
  '/:id/recovery',
  ...requirePermission('recovery_manage'),
  validateParams(userIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, disabled: true }
    });
    if (!user || user.disabled)
      return res.status(404).json({ msg: 'User not found' });

    const token = generateRecoveryToken();
    const resetUrl = `${emailConfig.siteUrl}/recovery?token=${token}`;

    // Send email first — only touch DB if delivery succeeds
    const sent = await sendRecoveryEmail(user.email, resetUrl);
    if (!sent) {
      return res.status(502).json({ msg: 'Email delivery is not configured' });
    }

    await persistRecoveryToken(id, token);
    await audit(prisma, req.user.id, 'recovery.admin_triggered', 'User', id);
    res.json({ msg: 'Recovery email sent' });
  })
);

// GET /api/users/:id/warnings
router.get(
  '/:id/warnings',
  ...requirePermission('users_warn'),
  validateParams(userIdParamsSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const warnings = await prisma.userWarning.findMany({
      where: { userId: id },
      include: { warnedBy: { select: { id: true, username: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(warnings);
  })
);

// POST /api/users/:id/warn
router.post(
  '/:id/warn',
  ...requirePermission('users_warn'),
  validateParams(userIdParamsSchema),
  validate(warnUserSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { reason, expiresAt } = parsedBody<WarnUserInput>(res);
    const warning = await warnUser(id, req.user.id, reason, expiresAt);
    res.status(201).json({ warning });
  })
);

// DELETE /api/users/:id/warnings/:warnId
router.delete(
  '/:id/warnings/:warnId',
  ...requirePermission('users_warn'),
  validateParams(warningParamsSchema),
  authHandler(async (_req, res) => {
    const { id, warnId } = parsedParams<{ id: number; warnId: number }>(res);
    await deleteWarning(id, warnId);
    res.status(204).send();
  })
);

// GET /api/users/:id/notes
router.get(
  '/:id/notes',
  ...requirePermission('users_edit'),
  validateParams(userIdParamsSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const notes = await prisma.userModerationNote.findMany({
      where: { userId: id },
      include: { author: { select: { id: true, username: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(notes);
  })
);

// POST /api/users/:id/notes
router.post(
  '/:id/notes',
  ...requirePermission('users_edit'),
  validateParams(userIdParamsSchema),
  validate(moderationNoteSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { body } = parsedBody<ModerationNoteInput>(res);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const note = await prisma.userModerationNote.create({
      data: { userId: id, authorId: req.user.id, body }
    });
    res.status(201).json({ note });
  })
);

// DELETE /api/users/:id/notes/:noteId
router.delete(
  '/:id/notes/:noteId',
  ...requirePermission('users_edit'),
  validateParams(noteParamsSchema),
  authHandler(async (_req, res) => {
    const { id, noteId } = parsedParams<{ id: number; noteId: number }>(res);
    const note = await prisma.userModerationNote.findFirst({
      where: { id: noteId, userId: id }
    });
    if (!note) return res.status(404).json({ msg: 'Note not found' });
    await prisma.userModerationNote.delete({ where: { id: noteId } });
    res.status(204).send();
  })
);

// POST /api/users/:id/disable
router.post(
  '/:id/disable',
  ...requirePermission('users_disable'),
  validateParams(userIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ msg: 'User not found' });
    await prisma.user.update({ where: { id }, data: { disabled: true } });
    await audit(prisma, req.user.id, 'user.disabled', 'User', id);
    res.json({ msg: 'User disabled' });
  })
);

// POST /api/users/:id/enable
router.post(
  '/:id/enable',
  ...requirePermission('users_disable'),
  validateParams(userIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ msg: 'User not found' });
    await prisma.user.update({ where: { id }, data: { disabled: false } });
    await audit(prisma, req.user.id, 'user.enabled', 'User', id);
    res.json({ msg: 'User enabled' });
  })
);

// GET /api/users/:id/rank
router.get(
  '/:id/rank',
  ...requirePermission('users_edit'),
  validateParams(userIdParamsSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        userRankId: true,
        rankLocked: true,
        secondaryRanks: {
          select: { userRankId: true },
          orderBy: { userRankId: 'asc' }
        }
      }
    });
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json({
      userRankId: user.userRankId,
      secondaryRankIds: user.secondaryRanks.map((entry) => entry.userRankId),
      // Canonical staff read of the lock state — the admin rank panel
      // initialises its toggle from here, alongside the rank it sets.
      rankLocked: user.rankLocked
    });
  })
);

// PUT /api/users/:id/rank
router.put(
  '/:id/rank',
  ...requirePermission('users_edit'),
  validateParams(userIdParamsSchema),
  validate(setRankSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { userRankId, secondaryRankIds } = parsedBody<SetRankInput>(res);
    await setUserRank(id, userRankId, secondaryRankIds, req.user.id);
    res.json({ msg: 'Rank updated' });
  })
);

// PUT /api/users/:id/rank-lock — freeze/unfreeze a user from auto
// class-progression (the engine no-ops on locked users). Deliberately its own
// route, NOT folded into setUserRank: that path replaces the whole
// secondary-rank set and would strip a Donor/VIP secondary on every toggle.
// Mirrors the primary-only update in rankProgressionJob.applyRankChange.
router.put(
  '/:id/rank-lock',
  ...requirePermission('users_edit'),
  validateParams(userIdParamsSchema),
  validate(rankLockSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { rankLocked } = parsedBody<RankLockInput>(res);
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true }
    });
    if (!target) return res.status(404).json({ msg: 'User not found' });
    await prisma.user.update({ where: { id }, data: { rankLocked } });
    await audit(prisma, req.user.id, 'user.rank_lock_changed', 'User', id, {
      rankLocked
    });
    res.json({ msg: rankLocked ? 'Rank locked' : 'Rank unlocked' });
  })
);

// POST /api/users/:id/donor
router.post(
  '/:id/donor',
  ...requirePermission('donor_ranks_manage'),
  validateParams(userIdParamsSchema),
  validate(grantDonorSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { donorRankId, expiresAt } = parsedBody<GrantDonorInput>(res);
    await grantDonorStatus(id, donorRankId, expiresAt ?? null, req.user.id);
    res.status(201).json({ msg: 'Donor status granted' });
  })
);

// DELETE /api/users/:id/donor
router.delete(
  '/:id/donor',
  ...requirePermission('donor_ranks_manage'),
  validateParams(userIdParamsSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    await prisma.$transaction([
      prisma.userDonorRank.deleteMany({ where: { userId: id } }),
      prisma.user.update({ where: { id }, data: { isDonor: false } })
    ]);
    res.status(204).send();
  })
);

// GET /api/users/:id/ip-history
router.get(
  '/:id/ip-history',
  ...requirePermission('users_view_ips'),
  validateParams(userIdParamsSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const history = await getUserIpHistory(id);
    res.json(history);
  })
);

// GET /api/users/:id/email-history
router.get(
  '/:id/email-history',
  ...requirePermission('users_view_email'),
  validateParams(userIdParamsSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const history = await prisma.userEmailHistory.findMany({
      where: { userId: id },
      select: {
        newEmail: true,
        changedAt: true
      },
      orderBy: { changedAt: 'desc' }
    });
    res.json(
      history.map((row) => ({
        email: row.newEmail,
        changedAt: row.changedAt.toISOString()
      }))
    );
  })
);

// PUT /api/users/:id/irc-nick — open a Nick Claim, or clear the link (self or
// admin). Setting a nick does NOT bind it — it issues a Verification Code the
// member must prove from that nick on IRC (ADR-0015). Admins can claim/clear on a
// member's behalf but cannot mint verified status; only Nick Verification can.
const ircNickSchema = z.object({
  ircNick: z
    .string()
    .max(30)
    .regex(
      /^[a-zA-Z_\-[\]\\^{}|`][a-zA-Z0-9_\-[\]\\^{}|`]*$/,
      'Invalid IRC nick'
    )
    .nullable()
});

router.put(
  '/:id/irc-nick',
  requireAuth,
  validateParams(userIdParamsSchema),
  validate(ircNickSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { ircNick } = parsedBody<{ ircNick: string | null }>(res);

    const perms = await loadPermissions(req, res);
    const isAdmin = hasPermission(perms, 'admin');
    const isSelf = req.user.id === id;

    if (!isAdmin && !isSelf) {
      return res.status(403).json({ msg: 'Permission denied' });
    }

    if (!ircNick) {
      await clearIrcNick(id);
      return res.json({ msg: 'IRC nick cleared' });
    }

    // claimIrcNick throws AppError(409) if the nick is already verified elsewhere.
    const { code, expiresAt, alreadyVerified } = await claimIrcNick(
      id,
      ircNick
    );
    if (alreadyVerified) {
      return res.json({ msg: 'IRC nick already verified', ircNick });
    }
    res.json({
      msg: 'Verification required',
      ircNick,
      code,
      expiresAt,
      instructions: `Send "!verify ${code}" in a private message to the stellar-bridge bot from the nick ${ircNick} within 30 minutes.`
    });
  })
);

// GET /api/users/:id/reputation — CRS for an account by id (korin service call,
// ADR-0013). Service-key gated; the self-serve view is /api/profile/me/reputation.
router.get(
  '/:id/reputation',
  requireServiceKey,
  validateParams(userIdParamsSchema),
  asyncHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    res.json(await getReputation(id));
  })
);

// GET /api/users/:id/snatch-list
router.get(
  '/:id/snatch-list',
  ...requirePermission('staff'),
  validateParams(userIdParamsSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const items = await getSnatchList(id);
    res.json(items);
  })
);

export default router;
