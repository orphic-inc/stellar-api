import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { validate, validateParams } from '../../middleware/validate';
import {
  stylesheetSchema,
  type StylesheetInput
} from '../../schemas/stylesheet';

const router = express.Router();
const stylesheetIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/stylesheet
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const stylesheets = await prisma.stylesheet.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(stylesheets);
  })
);

// GET /api/stylesheet/:id
router.get(
  '/:id',
  requireAuth,
  validateParams(stylesheetIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as unknown as { id: number };
    const stylesheet = await prisma.stylesheet.findUnique({ where: { id } });
    if (!stylesheet)
      return res.status(404).json({ msg: 'Stylesheet not found' });
    res.json(stylesheet);
  })
);

// POST /api/stylesheet
router.post(
  '/',
  requireAuth,
  validate(stylesheetSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, cssUrl } = req.body as StylesheetInput;
    const stylesheet = await prisma.stylesheet.create({
      data: { name, cssUrl }
    });
    res.status(201).json(stylesheet);
  })
);

// DELETE /api/stylesheet/:id
router.delete(
  '/:id',
  requireAuth,
  validateParams(stylesheetIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as unknown as { id: number };
    const existing = await prisma.stylesheet.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Stylesheet not found' });
    await prisma.stylesheet.delete({ where: { id } });
    res.json({ msg: 'Stylesheet removed' });
  })
);

export default router;
