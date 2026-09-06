import express from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authHandler } from '../../modules/asyncHandler';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import { audit } from '../../lib/audit';
import { normalizeIp, denormalizeIp } from '../../lib/ipAddress';
import { invalidateIpBanCache } from '../../modules/ipBan';

const router = express.Router();

const ipBanIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// Bounds are normalised to 32 hex chars (lib/ipAddress.ts). The route still
// speaks addresses, so the admin API is unchanged — but it now accepts IPv6 as
// well, which the previous Int columns could not represent at all even though
// nginx listens on [::]:80.
const ipBanSchema = z
  .object({
    fromIp: z.string().refine((v) => normalizeIp(v) !== null, {
      message: 'Invalid IP address'
    }),
    toIp: z
      .string()
      .refine((v) => normalizeIp(v) !== null, {
        message: 'Invalid IP address'
      })
      .optional()
  })
  .superRefine((value, ctx) => {
    const from = normalizeIp(value.fromIp);
    const to = normalizeIp(value.toIp ?? value.fromIp);
    if (from === null || to === null) return;
    // Fixed-width hex means a plain string comparison is the numeric one, so
    // this check is now correct for ranges the old signed-Int version accepted
    // and then stored unsatisfiably — 100.0.0.0 to 200.0.0.0 among them.
    if (from > to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toIp'],
        message: '`toIp` must be greater than or equal to `fromIp`'
      });
    }
    // A range must not straddle the two address families: the space between
    // them is every IPv4-mapped address plus most of IPv6, which is never what
    // a moderator means.
    const v4 = (h: string) => h.startsWith('00000000000000000000ffff');
    if (v4(from) !== v4(to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toIp'],
        message: 'A range cannot span both IPv4 and IPv6'
      });
    }
  });

type IpBanInput = z.infer<typeof ipBanSchema>;

const serializeBan = (ban: { id: number; fromIp: string; toIp: string }) => ({
  id: ban.id,
  fromIp: denormalizeIp(ban.fromIp),
  toIp: denormalizeIp(ban.toIp)
});

// GET /api/ip-bans
router.get(
  '/',
  ...requirePermission('ip_bans_manage'),
  authHandler(async (_req, res) => {
    const bans = await prisma.ipBan.findMany({ orderBy: { id: 'asc' } });
    res.json(bans.map(serializeBan));
  })
);

// POST /api/ip-bans
router.post(
  '/',
  ...requirePermission('ip_bans_manage'),
  validate(ipBanSchema),
  authHandler(async (req, res) => {
    const { fromIp, toIp } = parsedBody<IpBanInput>(res);
    const from = normalizeIp(fromIp);
    const to = normalizeIp(toIp ?? fromIp);
    if (from === null || to === null) {
      return res.status(400).json({ msg: 'Invalid IP address' });
    }
    const ban = await prisma.ipBan.create({ data: { fromIp: from, toIp: to } });
    // The enforcement cache is a minute stale by default; a ban a moderator
    // just typed should bite immediately.
    invalidateIpBanCache();
    await audit(prisma, req.user.id, 'ipban.create', 'IpBan', ban.id, {
      fromIp,
      toIp: toIp ?? fromIp
    });
    res.status(201).json(serializeBan(ban));
  })
);

// DELETE /api/ip-bans/:id
router.delete(
  '/:id',
  ...requirePermission('ip_bans_manage'),
  validateParams(ipBanIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const ban = await prisma.ipBan.findUnique({ where: { id } });
    if (!ban) return res.status(404).json({ msg: 'Ban not found' });
    await prisma.ipBan.delete({ where: { id } });
    // Likewise on the way out — an unbanned network must not stay locked out
    // for the rest of the TTL.
    invalidateIpBanCache();
    await audit(prisma, req.user.id, 'ipban.delete', 'IpBan', id);
    res.status(204).send();
  })
);

export default router;
