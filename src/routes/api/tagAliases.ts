import express from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  validateQuery,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import {
  parsedPage,
  paginatedResponse,
  paginationBase
} from '../../lib/pagination';
import {
  createTagAliasSchema,
  updateTagAliasSchema,
  type CreateTagAliasInput,
  type UpdateTagAliasInput
} from '../../schemas/tagAliases';
import { AppError } from '../../lib/errors';

const router = express.Router();
const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const tagAliasesQuerySchema = z.object({ ...paginationBase });

// GET /api/tag-aliases
router.get(
  '/',
  ...requirePermission('tags_manage'),
  validateQuery(tagAliasesQuerySchema),
  asyncHandler(async (req, res) => {
    const pg = parsedPage(res);
    const [aliases, total] = await Promise.all([
      prisma.tagAlias.findMany({
        include: {
          goodTag: { select: { id: true, name: true } },
          createdBy: { select: { id: true, username: true } }
        },
        orderBy: { badTag: 'asc' },
        skip: pg.skip,
        take: pg.limit
      }),
      prisma.tagAlias.count()
    ]);
    paginatedResponse(res, aliases, total, pg);
  })
);

// POST /api/tag-aliases
router.post(
  '/',
  ...requirePermission('tags_manage'),
  validate(createTagAliasSchema),
  authHandler(async (req, res) => {
    const { badTag, goodTag: goodTagName } =
      parsedBody<CreateTagAliasInput>(res);
    const goodTag = await prisma.tag.findUnique({
      where: { name: goodTagName }
    });
    if (!goodTag) throw new AppError(404, `Tag "${goodTagName}" not found`);
    const alias = await prisma.tagAlias.create({
      data: { badTag, goodTagId: goodTag.id, createdById: req.user.id },
      include: {
        goodTag: { select: { id: true, name: true } },
        createdBy: { select: { id: true, username: true } }
      }
    });
    res.status(201).json(alias);
  })
);

// PUT /api/tag-aliases/:id
router.put(
  '/:id',
  ...requirePermission('tags_manage'),
  validateParams(idParamsSchema),
  validate(updateTagAliasSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { badTag, goodTag: goodTagName } =
      parsedBody<UpdateTagAliasInput>(res);
    const existing = await prisma.tagAlias.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Tag alias not found');
    const goodTag = await prisma.tag.findUnique({
      where: { name: goodTagName }
    });
    if (!goodTag) throw new AppError(404, `Tag "${goodTagName}" not found`);
    const alias = await prisma.tagAlias.update({
      where: { id },
      data: { badTag, goodTagId: goodTag.id },
      include: {
        goodTag: { select: { id: true, name: true } },
        createdBy: { select: { id: true, username: true } }
      }
    });
    res.json(alias);
  })
);

// DELETE /api/tag-aliases/:id
router.delete(
  '/:id',
  ...requirePermission('tags_manage'),
  validateParams(idParamsSchema),
  asyncHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const existing = await prisma.tagAlias.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Tag alias not found');
    await prisma.tagAlias.delete({ where: { id } });
    res.status(204).send();
  })
);

export default router;
