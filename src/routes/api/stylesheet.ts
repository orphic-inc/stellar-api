import express, { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requireStrictAdmin } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import {
  stylesheetSchema,
  stylesheetUpdateSchema,
  authorStylesheetSchema,
  type StylesheetInput,
  type StylesheetUpdateInput,
  type AuthorStylesheetInput
} from '../../schemas/stylesheet';
import {
  createStylesheet,
  updateStylesheet,
  deleteStylesheet,
  getStylesheetStats
} from '../../modules/stylesheet';
import {
  upsertAuthorStylesheet,
  getAuthorStylesheet
} from '../../modules/authorStylesheet';
import { prisma } from '../../lib/prisma';

const router = express.Router();
const stylesheetIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});
const authorIdParamsSchema = z.object({
  userId: z.coerce.number().int().positive()
});

// ─── AuthorStylesheet (PRD-03 #118) — registered before /:id ──────────────────

// POST /api/stylesheet/author — save (create or replace) my AuthorStylesheet.
router.post(
  '/author',
  requireAuth,
  validate(authorStylesheetSchema),
  authHandler(async (req, res) => {
    const data = parsedBody<AuthorStylesheetInput>(res);
    const sheet = await upsertAuthorStylesheet(req.user.id, data);
    res.status(201).json(sheet);
  })
);

// GET /api/stylesheet/author/:userId — read an author's stylesheet.
router.get(
  '/author/:userId',
  requireAuth,
  validateParams(authorIdParamsSchema),
  authHandler(async (_req, res) => {
    const { userId } = parsedParams<{ userId: number }>(res);
    const sheet = await getAuthorStylesheet(userId);
    if (!sheet) {
      res.status(404).json({ msg: 'Author stylesheet not found' });
      return;
    }
    res.json(sheet);
  })
);

// GET /api/stylesheet/admin/stats — must be before /:id
router.get(
  '/admin/stats',
  ...requireStrictAdmin(),
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = await getStylesheetStats();
    res.json(stats);
  })
);

// GET /api/stylesheet
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const stylesheets = await prisma.stylesheet.findMany({
      orderBy: { createdAt: 'asc' }
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
    const { id } = parsedParams<{ id: number }>(res);
    const stylesheet = await prisma.stylesheet.findUnique({ where: { id } });
    if (!stylesheet)
      return res.status(404).json({ msg: 'Stylesheet not found' });
    res.json(stylesheet);
  })
);

// POST /api/stylesheet
router.post(
  '/',
  ...requireStrictAdmin(),
  validate(stylesheetSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = parsedBody<StylesheetInput>(res);
    const stylesheet = await createStylesheet({
      name: data.name,
      description: data.description ?? '',
      cssUrl: data.cssUrl,
      isDefault: data.isDefault ?? false
    });
    res.status(201).json(stylesheet);
  })
);

// PUT /api/stylesheet/:id
router.put(
  '/:id',
  ...requireStrictAdmin(),
  validateParams(stylesheetIdParamsSchema),
  validate(stylesheetUpdateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const data = parsedBody<StylesheetUpdateInput>(res);
    const stylesheet = await updateStylesheet(id, data);
    res.json(stylesheet);
  })
);

// DELETE /api/stylesheet/:id
router.delete(
  '/:id',
  ...requireStrictAdmin(),
  validateParams(stylesheetIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    await deleteStylesheet(id);
    res.status(204).send();
  })
);

export default router;
