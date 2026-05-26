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

const router = express.Router();

const ipBanIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

const parseIpv4ToInt = (ip: string): number | null => {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  if (!parts.every((part) => /^\d{1,3}$/.test(part))) return null;

  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;

  const [a, b, c, d] = octets;
  return (a * 16777216 + b * 65536 + c * 256 + d) | 0;
};

const ipBanSchema = z
  .object({
    fromIp: z.string().refine((value) => parseIpv4ToInt(value) !== null, {
      message: 'Invalid IPv4 address'
    }),
    toIp: z
      .string()
      .refine((value) => parseIpv4ToInt(value) !== null, {
        message: 'Invalid IPv4 address'
      })
      .optional()
  })
  .superRefine((value, ctx) => {
    const fromInt = parseIpv4ToInt(value.fromIp);
    const toInt = parseIpv4ToInt(value.toIp ?? value.fromIp);
    if (fromInt === null || toInt === null) return;
    if (fromInt >>> 0 > toInt >>> 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toIp'],
        message: '`toIp` must be greater than or equal to `fromIp`'
      });
    }
  });

type IpBanInput = z.infer<typeof ipBanSchema>;

// Signed 32-bit int back to IPv4 string
const intToIp = (n: number): string => {
  const u = n >>> 0;
  return [u >>> 24, (u >>> 16) & 0xff, (u >>> 8) & 0xff, u & 0xff].join('.');
};

const serializeBan = (ban: { id: number; fromIp: number; toIp: number }) => ({
  id: ban.id,
  fromIp: intToIp(ban.fromIp),
  toIp: intToIp(ban.toIp)
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
    const fromInt = parseIpv4ToInt(fromIp);
    const toInt = parseIpv4ToInt(toIp ?? fromIp);
    if (fromInt === null || toInt === null) {
      return res.status(400).json({ msg: 'Invalid IPv4 address' });
    }
    const ban = await prisma.ipBan.create({
      data: { fromIp: fromInt, toIp: toInt }
    });
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
    await audit(prisma, req.user.id, 'ipban.delete', 'IpBan', id);
    res.status(204).send();
  })
);

export default router;
