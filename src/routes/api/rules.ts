import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import { authHandler } from '../../modules/asyncHandler';
import { AppError } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { sanitizeHtml } from '../../lib/sanitize';
import {
  createRulesPageSchema,
  updateRulesPageSchema,
  rulesPageParamsSchema,
  rulesSlugParamsSchema,
  normalizeRulesSlug,
  type CreateRulesPageInput,
  type UpdateRulesPageInput
} from '../../schemas/rules';
import { resolveSiteVariables } from '../../modules/siteVariables';

const router = Router();

const pageSelect = {
  id: true,
  slug: true,
  title: true,
  body: true,
  isMain: true,
  sortOrder: true,
  authorId: true,
  author: { select: { id: true, username: true } },
  createdAt: true,
  updatedAt: true
} as const;

// GET / — list: { main, pages }
router.get(
  '/',
  requireAuth,
  authHandler(async (_req, res) => {
    const [main, pages] = await Promise.all([
      prisma.rulesPage.findFirst({
        where: { isMain: true },
        select: pageSelect
      }),
      prisma.rulesPage.findMany({
        where: { isMain: false },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: pageSelect
      })
    ]);
    res.json({ main, pages });
  })
);

// GET /tree — the composable Rule/SubRule tree with CRS weights (PRD-05 #1),
// plus the resolved `variables` map for the `${...}` tokens carried verbatim in
// the rule bodies (PRD-09 / ADR-0020 — the API single-sources the values, the UI
// substitutes). Static segment — MUST be before /:slug or it'd be read as a
// rules-page slug. Login-gated only (rules are site-wide, visible to every member).
router.get(
  '/tree',
  requireAuth,
  authHandler(async (_req, res) => {
    const [rules, variables] = await Promise.all([
      prisma.rule.findMany({
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: {
          subRules: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }
        }
      }),
      resolveSiteVariables(prisma)
    ]);
    res.json({ rules, variables });
  })
);

// GET /:slug — single page (static 'manager' would shadow this if registered after; frontend uses 'manager')
router.get(
  '/:slug',
  requireAuth,
  validateParams(rulesSlugParamsSchema),
  authHandler(async (_req, res) => {
    const { slug } = parsedParams<{ slug: string }>(res);
    const page = await prisma.rulesPage.findUnique({
      where: { slug },
      select: pageSelect
    });
    if (!page) throw new AppError(404, 'Page not found');
    res.json(page);
  })
);

// POST / — create page
router.post(
  '/',
  ...requirePermission('rules_manage'),
  validate(createRulesPageSchema),
  authHandler(async (req, res) => {
    const input = parsedBody<CreateRulesPageInput>(res);
    const slug = input.slug ?? normalizeRulesSlug(input.title);
    const body = sanitizeHtml(input.body);

    const page = await prisma.$transaction(async (tx) => {
      if (input.isMain) {
        const existing = await tx.rulesPage.findFirst({
          where: { isMain: true },
          select: { id: true }
        });
        if (existing)
          throw new AppError(409, 'A main rules page already exists');
      }

      const existing = await tx.rulesPage.findUnique({
        where: { slug },
        select: { id: true }
      });
      if (existing)
        throw new AppError(409, 'A page with this slug already exists');

      const created = await tx.rulesPage.create({
        data: {
          slug,
          title: input.title,
          body,
          isMain: input.isMain ?? false,
          sortOrder: input.sortOrder ?? 0,
          authorId: req.user.id
        },
        select: pageSelect
      });

      await audit(tx, req.user.id, 'rules.create', 'RulesPage', created.id, {
        title: input.title,
        slug,
        isMain: created.isMain
      });
      return created;
    });

    res.status(201).json(page);
  })
);

// PUT /:id — update page (slug is immutable after creation)
router.put(
  '/:id',
  ...requirePermission('rules_manage'),
  validateParams(rulesPageParamsSchema),
  validate(updateRulesPageSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const input = parsedBody<UpdateRulesPageInput>(res);

    const page = await prisma.$transaction(async (tx) => {
      const existing = await tx.rulesPage.findUnique({
        where: { id },
        select: { id: true, isMain: true }
      });
      if (!existing) throw new AppError(404, 'Page not found');

      if (input.isMain && !existing.isMain) {
        const currentMain = await tx.rulesPage.findFirst({
          where: { isMain: true },
          select: { id: true }
        });
        if (currentMain)
          throw new AppError(409, 'A main rules page already exists');
      }

      const updated = await tx.rulesPage.update({
        where: { id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.body !== undefined && { body: sanitizeHtml(input.body) }),
          ...(input.isMain !== undefined && { isMain: input.isMain }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder })
        },
        select: pageSelect
      });

      await audit(tx, req.user.id, 'rules.edit', 'RulesPage', id, {
        title: updated.title
      });
      return updated;
    });

    res.json(page);
  })
);

// DELETE /:id — delete page (cannot delete the main page)
router.delete(
  '/:id',
  ...requirePermission('rules_manage'),
  validateParams(rulesPageParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.rulesPage.findUnique({
        where: { id },
        select: { id: true, isMain: true, title: true }
      });
      if (!existing) throw new AppError(404, 'Page not found');
      if (existing.isMain)
        throw new AppError(400, 'Cannot delete the main rules page');

      await tx.rulesPage.delete({ where: { id } });
      await audit(tx, req.user.id, 'rules.delete', 'RulesPage', id, {
        title: existing.title
      });
    });

    res.status(204).send();
  })
);

export default router;
