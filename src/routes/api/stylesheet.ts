import express, { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  validateQuery
} from '../../middleware/validate';
import {
  paginatedResponse,
  paginationBase,
  pageOf
} from '../../lib/pagination';
import {
  stylesheetSchema,
  stylesheetUpdateSchema,
  authorStylesheetSchema
} from '../../schemas/stylesheet';
import {
  createStylesheet,
  updateStylesheet,
  deleteStylesheet,
  getStylesheetStats
} from '../../modules/stylesheet';
import {
  createAuthorStylesheet,
  listAuthorStylesheets,
  getAuthorStylesheetById,
  getAuthorStylesheetCss,
  adoptAuthorStylesheet,
  updateAuthorStylesheet,
  deleteAuthorStylesheet
} from '../../modules/authorStylesheet';
import { prisma } from '../../lib/prisma';

const router = express.Router();
const stylesheetUpdateBody = validate(stylesheetUpdateSchema);
const stylesheetBody = validate(stylesheetSchema);
const authorStylesheetBody = validate(authorStylesheetSchema);
const stylesheetIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});
const stylesheetIdParams = validateParams(stylesheetIdParamsSchema);
const authorIdParamsSchema = z.object({
  userId: z.coerce.number().int().positive()
});
const authorIdParams = validateParams(authorIdParamsSchema);
const listAuthorStylesheetsQuerySchema = z.object({ ...paginationBase });
const listAuthorStylesheetsQuery = validateQuery(
  listAuthorStylesheetsQuerySchema
);

// ─── AuthorStylesheet (PRD-03 #118/#119/#120/#146) — registered before /:id ───

// POST /api/stylesheet/author — author a new stylesheet (many per author,
// rank-gated by UserRank.authorStylesheetLimit — #146).
router.post(
  '/author',
  requireAuth,
  authorStylesheetBody,
  authHandler(async (req, res) => {
    const data = authorStylesheetBody.read(res);
    const sheet = await createAuthorStylesheet(req.user.id, data);
    res.status(201).json(sheet);
  })
);

// GET /api/stylesheet/author/:userId — list an author's stylesheets, paginated (#146).
router.get(
  '/author/:userId',
  requireAuth,
  authorIdParams,
  listAuthorStylesheetsQuery,
  authHandler(async (_req, res) => {
    const { userId } = authorIdParams.read(res);
    const pg = pageOf(listAuthorStylesheetsQuery.read(res));
    const [rows, total] = await listAuthorStylesheets(userId, pg);
    paginatedResponse(res, rows, total, pg);
  })
);

// GET /api/stylesheet/author-stylesheet/:id — read one authored stylesheet.
router.get(
  '/author-stylesheet/:id',
  requireAuth,
  stylesheetIdParams,
  authHandler(async (_req, res) => {
    const { id } = stylesheetIdParams.read(res);
    const sheet = await getAuthorStylesheetById(id);
    if (!sheet) {
      res.status(404).json({ msg: 'Author stylesheet not found' });
      return;
    }
    res.json(sheet);
  })
);

// PUT /api/stylesheet/author-stylesheet/:id — edit a sheet in place (ADR-0032
// §2). Author-scoped; edits propagate live to every adopter (#350).
router.put(
  '/author-stylesheet/:id',
  requireAuth,
  stylesheetIdParams,
  authorStylesheetBody,
  authHandler(async (req, res) => {
    const { id } = stylesheetIdParams.read(res);
    const data = authorStylesheetBody.read(res);
    res.json(await updateAuthorStylesheet(id, req.user.id, data));
  })
);

// DELETE /api/stylesheet/author-stylesheet/:id — withdraw a sheet (ADR-0032 §3).
// Author-scoped and soft: frees the registry space, and existing adopters keep
// rendering because only the /css route ignores deletedAt.
router.delete(
  '/author-stylesheet/:id',
  requireAuth,
  stylesheetIdParams,
  authHandler(async (req, res) => {
    const { id } = stylesheetIdParams.read(res);
    await deleteAuthorStylesheet(id, req.user.id);
    res.status(204).send();
  })
);

// GET /api/stylesheet/author-stylesheet/:id/css — deliver the stored (already
// store-time-sanitized, ADR-0003 Arm 2) source as CSS the browser links. This is
// the *only* route a registry sheet leaves by as a stylesheet payload (ADR-0024
// §1); the injector links it exactly as Personal links an external URL, so the
// ADR-0003 "href, never CSS text" boundary stays one-shaped.
router.get(
  '/author-stylesheet/:id/css',
  requireAuth,
  stylesheetIdParams,
  authHandler(async (_req, res) => {
    const { id } = stylesheetIdParams.read(res);
    const sheet = await getAuthorStylesheetCss(id);
    if (!sheet) {
      res.status(404).json({ msg: 'Author stylesheet not found' });
      return;
    }
    // Sheets are mutable (authors edit in place) — revalidate rather than cache.
    // nosniff: this origin serves user-authored bytes; pin the type so a browser
    // can't be talked into interpreting them as anything but CSS (no helmet here).
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(sheet.source);
  })
);

// POST /api/stylesheet/author-stylesheet/:id/adopt — adopt a stylesheet into my
// Site Stylesheet slot (#119); a non-self adoption accrues to the author (#120).
router.post(
  '/author-stylesheet/:id/adopt',
  requireAuth,
  stylesheetIdParams,
  authHandler(async (req, res) => {
    const { id } = stylesheetIdParams.read(res);
    const result = await adoptAuthorStylesheet(req.user.id, id);
    res.json(result);
  })
);

// GET /api/stylesheet/admin/stats — must be before /:id
router.get(
  '/admin/stats',
  ...requirePermission('admin'),
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
  stylesheetIdParams,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = stylesheetIdParams.read(res);
    const stylesheet = await prisma.stylesheet.findUnique({ where: { id } });
    if (!stylesheet)
      return res.status(404).json({ msg: 'Stylesheet not found' });
    res.json(stylesheet);
  })
);

// POST /api/stylesheet
router.post(
  '/',
  ...requirePermission('admin'),
  stylesheetBody,
  asyncHandler(async (req: Request, res: Response) => {
    const data = stylesheetBody.read(res);
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
  ...requirePermission('admin'),
  stylesheetIdParams,
  stylesheetUpdateBody,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = stylesheetIdParams.read(res);
    const data = stylesheetUpdateBody.read(res);
    const stylesheet = await updateStylesheet(id, data);
    res.json(stylesheet);
  })
);

// DELETE /api/stylesheet/:id
router.delete(
  '/:id',
  ...requirePermission('admin'),
  stylesheetIdParams,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = stylesheetIdParams.read(res);
    await deleteStylesheet(id);
    res.status(204).send();
  })
);

export default router;
