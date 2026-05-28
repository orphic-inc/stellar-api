import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  parsedBody,
  validateParams,
  parsedParams,
  validateQuery,
  parsedQuery
} from '../../middleware/validate';
import { audit } from '../../lib/audit';
import {
  parsedPage,
  paginatedResponse,
  paginationBase
} from '../../lib/pagination';

const router = express.Router();

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

const donationsQuerySchema = z.object({
  ...paginationBase,
  userId: z.coerce.number().int().positive().optional()
});

type DonationsQuery = z.infer<typeof donationsQuerySchema>;

const createDonationSchema = z.object({
  userId: z.number().int().positive(),
  amount: z.number().positive(),
  email: z.string().email(),
  donatedAt: z.string().datetime(),
  currency: z.string().default('USD'),
  source: z.string().default(''),
  reason: z.string().min(1, 'Reason is required')
});

type CreateDonationInput = z.infer<typeof createDonationSchema>;

// GET /api/donations
router.get(
  '/',
  ...requirePermission('admin'),
  validateQuery(donationsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = parsedQuery<DonationsQuery>(res);
    const where = userId ? { userId } : undefined;
    const pg = parsedPage(res);
    const [rows, total] = await Promise.all([
      prisma.donation.findMany({
        where,
        orderBy: { donatedAt: 'desc' },
        skip: pg.skip,
        take: pg.limit,
        include: {
          user: { select: { id: true, username: true } }
        }
      }),
      prisma.donation.count({ where })
    ]);
    paginatedResponse(res, rows, total, pg);
  })
);

// POST /api/donations — manual entry
router.post(
  '/',
  ...requirePermission('admin'),
  validate(createDonationSchema),
  authHandler(async (req, res) => {
    const input = parsedBody<CreateDonationInput>(res);
    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) return res.status(404).json({ msg: 'User not found' });
    const donation = await prisma.donation.create({
      data: {
        userId: input.userId,
        amount: input.amount,
        email: input.email,
        donatedAt: new Date(input.donatedAt),
        currency: input.currency,
        source: input.source,
        reason: input.reason
      },
      include: { user: { select: { id: true, username: true } } }
    });
    await audit(
      prisma,
      req.user.id,
      'donation.create',
      'Donation',
      donation.id,
      {
        userId: input.userId,
        amount: input.amount
      }
    );
    res.status(201).json(donation);
  })
);

// DELETE /api/donations/:id
router.delete(
  '/:id',
  ...requirePermission('admin'),
  validateParams(idParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const donation = await prisma.donation.findUnique({ where: { id } });
    if (!donation) return res.status(404).json({ msg: 'Donation not found' });
    await prisma.donation.delete({ where: { id } });
    await audit(prisma, req.user.id, 'donation.delete', 'Donation', id);
    res.status(204).send();
  })
);

export default router;
