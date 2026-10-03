import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { translatePrismaError } from '../../lib/prismaErrors';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  validateQuery
} from '../../middleware/validate';
import { audit } from '../../lib/audit';
import {
  paginatedResponse,
  paginationBase,
  pageOf
} from '../../lib/pagination';
import { createDonationSchema } from '../../schemas/donations';

const router = express.Router();
const createDonationBody = validate(createDonationSchema);

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const idParams = validateParams(idParamsSchema);

const donationsQuerySchema = z.object({
  ...paginationBase,
  userId: z.coerce.number().int().positive().optional()
});
const donationsQuery = validateQuery(donationsQuerySchema);

// GET /api/donations
router.get(
  '/',
  ...requirePermission('admin'),
  donationsQuery,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = donationsQuery.read(res);
    const where = userId ? { userId } : undefined;
    const pg = pageOf(donationsQuery.read(res));
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
  createDonationBody,
  authHandler(async (req, res) => {
    const input = createDonationBody.read(res);
    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) return res.status(404).json({ msg: 'User not found' });
    let donation;
    try {
      donation = await prisma.donation.create({
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
    } catch (err) {
      // `userId` arrives in the BODY and the read above leaves its window
      // open — the route exists, the payload names an absent user (#564).
      translatePrismaError(err, { P2003: [400, 'User not found'] });
    }
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
  idParams,
  authHandler(async (req, res) => {
    const { id } = idParams.read(res);
    const donation = await prisma.donation.findUnique({ where: { id } });
    if (!donation) return res.status(404).json({ msg: 'Donation not found' });
    try {
      await prisma.donation.delete({ where: { id } });
    } catch (err) {
      translatePrismaError(err, { P2025: [404, 'Donation not found'] });
    }
    await audit(prisma, req.user.id, 'donation.delete', 'Donation', id);
    res.status(204).send();
  })
);

export default router;
