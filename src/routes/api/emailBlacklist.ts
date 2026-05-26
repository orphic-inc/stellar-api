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

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

const emailBlacklistSchema = z.object({
  email: z.string().min(1, 'Email or domain is required'),
  comment: z.string().min(1, 'Comment is required')
});

type EmailBlacklistInput = z.infer<typeof emailBlacklistSchema>;

// GET /api/email-blacklist
router.get(
  '/',
  ...requirePermission('email_blacklist_manage'),
  authHandler(async (_req, res) => {
    const entries = await prisma.emailBlacklist.findMany({
      orderBy: { addedAt: 'desc' }
    });
    res.json(entries);
  })
);

// POST /api/email-blacklist
router.post(
  '/',
  ...requirePermission('email_blacklist_manage'),
  validate(emailBlacklistSchema),
  authHandler(async (req, res) => {
    const { email, comment } = parsedBody<EmailBlacklistInput>(res);
    const entry = await prisma.emailBlacklist.create({
      data: {
        userId: req.user.id,
        email,
        comment,
        addedAt: new Date()
      }
    });
    await audit(
      prisma,
      req.user.id,
      'emailblacklist.create',
      'EmailBlacklist',
      entry.id,
      { email }
    );
    res.status(201).json(entry);
  })
);

// DELETE /api/email-blacklist/:id
router.delete(
  '/:id',
  ...requirePermission('email_blacklist_manage'),
  validateParams(idParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const entry = await prisma.emailBlacklist.findUnique({ where: { id } });
    if (!entry) return res.status(404).json({ msg: 'Entry not found' });
    await prisma.emailBlacklist.delete({ where: { id } });
    await audit(
      prisma,
      req.user.id,
      'emailblacklist.delete',
      'EmailBlacklist',
      id
    );
    res.status(204).send();
  })
);

export default router;
