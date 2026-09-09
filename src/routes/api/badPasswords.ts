import express from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { translatePrismaError } from '../../lib/prismaErrors';
import { authHandler } from '../../modules/asyncHandler';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateQuery,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import { audit } from '../../lib/audit';
import {
  paginationBase,
  parsedPage,
  paginatedResponse
} from '../../lib/pagination';
import { normalizePassword } from '../../modules/badPasswords';

const router = express.Router();

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

const listQuerySchema = z.object({ ...paginationBase });

// Six characters is the floor every creation path enforces
// (`src/schemas/auth.ts`, `src/schemas/user.ts`), so a shorter entry could
// never be submitted to match against. Rejecting it here keeps staff from
// adding rows that cannot fire.
const badPasswordSchema = z.object({
  password: z
    .string()
    .min(6, 'Denied passwords must be at least 6 characters')
    .max(255)
});

type BadPasswordInput = z.infer<typeof badPasswordSchema>;

// GET /api/bad-passwords
//
// Paginated, unlike the sibling `/api/email-blacklist`. That list holds a
// handful of staff-added rows; this one ships with 237 seeded entries and only
// grows, which is the unbounded case AGENTS.md requires pagination for.
router.get(
  '/',
  ...requirePermission('bad_passwords_manage'),
  validateQuery(listQuerySchema),
  authHandler(async (_req, res) => {
    const pg = parsedPage(res);
    const [rows, total] = await Promise.all([
      prisma.badPassword.findMany({
        orderBy: { password: 'asc' },
        skip: pg.skip,
        take: pg.limit
      }),
      prisma.badPassword.count()
    ]);
    paginatedResponse(res, rows, total, pg);
  })
);

// POST /api/bad-passwords
router.post(
  '/',
  ...requirePermission('bad_passwords_manage'),
  validate(badPasswordSchema),
  authHandler(async (req, res) => {
    const { password } = parsedBody<BadPasswordInput>(res);
    // Normalised on the way in, exactly as `isPasswordBanned` normalises on the
    // way out. A mixed-case row would be stored but never matched.
    const normalized = normalizePassword(password);

    const existing = await prisma.badPassword.findUnique({
      where: { password: normalized },
      select: { id: true }
    });
    if (existing) {
      return res.status(409).json({ msg: 'Password is already denied' });
    }

    let entry;
    try {
      entry = await prisma.badPassword.create({
        data: { password: normalized, source: 'STAFF' }
      });
    } catch (err) {
      // `BadPassword.password` is unique and the model has no foreign key, so a
      // duplicate is the only reachable code (#564).
      translatePrismaError(err, {
        P2002: [409, 'That password is already listed']
      });
    }
    await audit(
      prisma,
      req.user.id,
      'badpassword.create',
      'BadPassword',
      entry.id
    );
    res.status(201).json(entry);
  })
);

// DELETE /api/bad-passwords/:id
//
// Seeded rows are deletable and stay deleted: the seed is guarded by
// `SiteSettings.badPasswordsSeededAt`, not by a row count, so a removal here is
// not undone on the next boot.
router.delete(
  '/:id',
  ...requirePermission('bad_passwords_manage'),
  validateParams(idParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const entry = await prisma.badPassword.findUnique({ where: { id } });
    if (!entry) return res.status(404).json({ msg: 'Entry not found' });
    try {
      await prisma.badPassword.delete({ where: { id } });
    } catch (err) {
      translatePrismaError(err, {
        P2025: [404, 'Entry not found']
      });
    }
    await audit(prisma, req.user.id, 'badpassword.delete', 'BadPassword', id);
    res.status(204).send();
  })
);

export default router;
