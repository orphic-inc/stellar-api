import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import {
  getUserSettings,
  updateUserSettings,
  createUser
} from '../../modules/user';
import { requireAuth } from '../../middleware/auth';
import {
  requirePermission,
  isModerator,
  loadPermissions
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
  donorRankSchema,
  grantDonorSchema,
  type AdminCreateUserInput,
  type UserSettingsInput,
  type WarnUserInput,
  type ModerationNoteInput,
  type SetRankInput,
  type DonorRankInput,
  type GrantDonorInput
} from '../../schemas/user';
import { audit } from '../../lib/audit';
import { parsePage, paginatedResponse } from '../../lib/pagination';
import { sendRecoveryEmail } from '../../lib/mailer';
import { email as emailConfig } from '../../modules/config';
import {
  statsPeriodQuerySchema,
  type StatsPeriodQuery
} from '../../schemas/statsHistory';
import { getUserStatHistory } from '../../modules/statsHistory';
import crypto from 'crypto';

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
const recoveryStatusSchema = z
  .enum(['pending', 'used', 'expired'])
  .default('pending');
const warningsQuerySchema = z.object({
  userId: z.coerce.number().int().positive().optional()
});
type WarningsQuery = z.infer<typeof warningsQuerySchema>;

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
  ...requirePermission('admin'),
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
  ...requirePermission('admin'),
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
  ...requirePermission('admin'),
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
    const grants = await prisma.downloadAccessGrant.findMany({
      where: { consumerId: req.user.id, status: 'COMPLETED' },
      include: {
        contribution: {
          include: {
            release: {
              select: {
                id: true,
                title: true,
                communityId: true,
                artist: { select: { name: true } }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    const seen = new Set<number>();
    const items = [];
    for (const g of grants) {
      const rel = g.contribution.release;
      if (!seen.has(rel.id)) {
        seen.add(rel.id);
        items.push({
          id: g.id,
          release: {
            id: rel.id,
            title: rel.title,
            communityId: rel.communityId
          },
          artist: rel.artist ?? null,
          downloadedAt: g.createdAt
        });
      }
      if (items.length >= 100) break;
    }
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

// ─── Staff recovery tools (static paths — must be before /:id) ───────────────

// GET /api/users/recovery-requests
router.get(
  '/recovery-requests',
  ...requirePermission('users_edit'),
  authHandler(async (req, res) => {
    const rawStatus = req.query.status as string | undefined;
    const statusResult = recoveryStatusSchema.safeParse(rawStatus ?? 'pending');
    const status = statusResult.success ? statusResult.data : 'pending';

    const now = new Date();
    const where =
      status === 'pending'
        ? { usedAt: null, expiresAt: { gt: now } }
        : status === 'used'
        ? { usedAt: { not: null } }
        : { usedAt: null, expiresAt: { lte: now } };

    const pg = parsePage(req);
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
  ...requirePermission('users_edit'),
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
  userId: z.coerce.number().int().positive().optional()
});
type SessionsQuery = z.infer<typeof sessionsQuerySchema>;

// GET /api/users/sessions — login watch (must be before /:id)
router.get(
  '/sessions',
  ...requirePermission('admin'),
  validateQuery(sessionsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsePage(req);
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
  status: z.string().optional()
});
type InvitesQuery = z.infer<typeof invitesQuerySchema>;

// GET /api/users/invites — invite pool (must be before /:id)
router.get(
  '/invites',
  ...requirePermission('admin'),
  validateQuery(invitesQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsePage(req);
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
  ...requirePermission('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsePage(req);
    const [trees, total] = await Promise.all([
      prisma.inviteTree.findMany({
        include: { user: { select: { id: true, username: true } } },
        orderBy: [
          { treeId: 'asc' },
          { treeLevel: 'asc' },
          { treePosition: 'asc' }
        ],
        skip: pg.skip,
        take: pg.limit
      }),
      prisma.inviteTree.count()
    ]);
    const inviterIds = [...new Set(trees.map((t) => t.inviterId))];
    const inviters = await prisma.user.findMany({
      where: { id: { in: inviterIds } },
      select: { id: true, username: true }
    });
    const inviterMap = new Map(inviters.map((u) => [u.id, u]));
    const rows = trees.map((t) => ({
      ...t,
      inviter: inviterMap.get(t.inviterId) ?? null
    }));
    paginatedResponse(res, rows, total, pg);
  })
);

// GET /api/users/ratio-watch — users on ratio watch or leech-disabled (must be before /:id)
router.get(
  '/ratio-watch',
  ...requirePermission('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsePage(req);
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
    const pg = parsePage(req);
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
  ...requirePermission('staff'),
  authHandler(async (_req, res) => {
    const dupes = await prisma.user.groupBy({
      by: ['lastIp'],
      where: { lastIp: { not: null } },
      _count: { lastIp: true },
      having: { lastIp: { _count: { gt: 1 } } },
      orderBy: { _count: { lastIp: 'desc' } }
    });
    const result = await Promise.all(
      dupes.map(async (d) => {
        const users = await prisma.user.findMany({
          where: { lastIp: d.lastIp! },
          select: {
            id: true,
            username: true,
            dateRegistered: true,
            disabled: true,
            lastLogin: true
          }
        });
        return { ip: d.lastIp!, count: d._count.lastIp, users };
      })
    );
    res.json(result);
  })
);

// GET /api/users/registration-log — users ordered by registration date (must be before /:id)
router.get(
  '/registration-log',
  ...requirePermission('staff'),
  authHandler(async (req, res) => {
    const pg = parsePage(req);
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
    const isStaff = await isModerator(req, res);
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

    if (isSelf && !isAdmin) {
      const ownRank = await prisma.userRank.findUnique({
        where: { id: req.user.userRankId },
        select: { displayStaff: true }
      });
      if (!ownRank?.displayStaff) {
        return res.status(403).json({ msg: 'Permission denied' });
      }
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true }
    });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    // Normalize empty string to null
    const normalized = staffBio?.trim() || null;
    await prisma.user.update({ where: { id }, data: { staffBio: normalized } });
    await audit(prisma, req.user.id, 'user.staffBio_updated', 'User', id, {
      staffBio: normalized
    });
    res.json({ msg: 'Staff bio updated' });
  })
);

// POST /api/users/:id/recovery — admin-triggered recovery email
router.post(
  '/:id/recovery',
  ...requirePermission('users_edit'),
  validateParams(userIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, disabled: true }
    });
    if (!user || user.disabled)
      return res.status(404).json({ msg: 'User not found' });

    const token = crypto.randomBytes(32).toString('hex');
    const resetUrl = `${emailConfig.siteUrl}/recovery?token=${token}`;

    // Send email first — only touch DB if delivery succeeds
    const sent = await sendRecoveryEmail(user.email, resetUrl);
    if (!sent) {
      return res.status(502).json({ msg: 'Email delivery is not configured' });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.accountRecovery.updateMany({
        where: { userId: id, usedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now }
      }),
      prisma.accountRecovery.create({
        data: { userId: id, token, expiresAt }
      })
    ]);

    await audit(prisma, req.user.id, 'recovery.admin_triggered', 'User', id);
    res.json({ msg: 'Recovery email sent' });
  })
);

// GET /api/users/:id/warnings
router.get(
  '/:id/warnings',
  ...requirePermission('staff'),
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

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const [warning] = await prisma.$transaction([
      prisma.userWarning.create({
        data: {
          userId: id,
          warnedById: req.user.id,
          reason,
          ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {})
        }
      }),
      prisma.user.update({
        where: { id },
        data: {
          warnedTimes: { increment: 1 },
          warned: new Date()
        }
      })
    ]);

    await audit(prisma, req.user.id, 'user.warned', 'User', id, { reason });
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
    const warning = await prisma.userWarning.findUnique({
      where: { id: warnId }
    });
    if (!warning || warning.userId !== id) {
      return res.status(404).json({ msg: 'Warning not found' });
    }
    await prisma.userWarning.delete({ where: { id: warnId } });
    const remaining = await prisma.userWarning.count({ where: { userId: id } });
    if (remaining === 0) {
      await prisma.user.update({ where: { id }, data: { warned: null } });
    }
    res.status(204).send();
  })
);

// GET /api/users/:id/notes
router.get(
  '/:id/notes',
  ...requirePermission('staff'),
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
  ...requirePermission('staff'),
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
  ...requirePermission('staff'),
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

// PUT /api/users/:id/rank
router.put(
  '/:id/rank',
  ...requirePermission('admin'),
  validateParams(userIdParamsSchema),
  validate(setRankSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { userRankId } = parsedBody<SetRankInput>(res);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const rank = await prisma.userRank.findUnique({
      where: { id: userRankId }
    });
    if (!rank) return res.status(404).json({ msg: 'Rank not found' });

    await prisma.user.update({
      where: { id },
      data: { userRankId }
    });
    await audit(prisma, req.user.id, 'user.rank_changed', 'User', id, {
      userRankId
    });
    res.json({ msg: 'Rank updated' });
  })
);

// POST /api/users/:id/donor
router.post(
  '/:id/donor',
  ...requirePermission('staff'),
  validateParams(userIdParamsSchema),
  validate(grantDonorSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { donorRankId, expiresAt } = parsedBody<GrantDonorInput>(res);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const donorRank = await prisma.donorRank.findUnique({
      where: { id: donorRankId }
    });
    if (!donorRank)
      return res.status(404).json({ msg: 'Donor rank not found' });

    // Explicit expiresAt wins; fall back to the rank's expiresAfterDays if set
    const computedExpiresAt = expiresAt
      ? new Date(expiresAt)
      : donorRank.expiresAfterDays != null
      ? new Date(Date.now() + donorRank.expiresAfterDays * 86_400_000)
      : null;

    await prisma.$transaction([
      prisma.userDonorRank.upsert({
        where: { userId: id },
        create: {
          userId: id,
          donorRankId,
          grantedById: req.user.id,
          ...(computedExpiresAt ? { expiresAt: computedExpiresAt } : {})
        },
        update: {
          donorRankId,
          grantedAt: new Date(),
          grantedById: req.user.id,
          expiresAt: computedExpiresAt
        }
      }),
      prisma.user.update({ where: { id }, data: { isDonor: true } })
    ]);

    await audit(prisma, req.user.id, 'user.donor_granted', 'User', id);
    res.status(201).json({ msg: 'Donor status granted' });
  })
);

// DELETE /api/users/:id/donor
router.delete(
  '/:id/donor',
  ...requirePermission('staff'),
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
  ...requirePermission('staff'),
  validateParams(userIdParamsSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const sessions = await prisma.userSession.findMany({
      where: { userId: id },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        lastActiveAt: true,
        revokedAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    const history = new Map<string, string>();
    for (const session of sessions) {
      if (!session.ipAddress) continue;
      const seenAt = (session.lastActiveAt ?? session.createdAt).toISOString();
      if (!history.has(session.ipAddress)) {
        history.set(session.ipAddress, seenAt);
      }
    }
    res.json(
      Array.from(history.entries()).map(([ip, seenAt]) => ({
        ip,
        seenAt
      }))
    );
  })
);

// GET /api/users/:id/email-history
router.get(
  '/:id/email-history',
  ...requirePermission('staff'),
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

// GET /api/users/:id/snatch-list
router.get(
  '/:id/snatch-list',
  ...requirePermission('staff'),
  validateParams(userIdParamsSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const grants = await prisma.downloadAccessGrant.findMany({
      where: { consumerId: id, status: 'COMPLETED' },
      include: {
        contribution: {
          include: {
            release: {
              select: {
                id: true,
                title: true,
                communityId: true,
                artist: { select: { name: true } }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    const seen = new Set<number>();
    const items = [];
    for (const g of grants) {
      const rel = g.contribution.release;
      if (!seen.has(rel.id)) {
        seen.add(rel.id);
        items.push({
          id: g.id,
          release: {
            id: rel.id,
            title: rel.title,
            communityId: rel.communityId
          },
          artist: rel.artist ?? null,
          downloadedAt: g.createdAt
        });
      }
      if (items.length >= 100) break;
    }
    res.json(items);
  })
);

export default router;
