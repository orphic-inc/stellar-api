import express from 'express';
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
import {
  paginatedResponse,
  paginationBase,
  pageOf
} from '../../lib/pagination';
import {
  createTagAliasSchema,
  updateTagAliasSchema
} from '../../schemas/tagAliases';
import { AppError } from '../../lib/errors';
import { prepareTagAlias } from '../../modules/tag';

const router = express.Router();
const updateTagAliasBody = validate(updateTagAliasSchema);
const createTagAliasBody = validate(createTagAliasSchema);
const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const idParams = validateParams(idParamsSchema);
const tagAliasesQuerySchema = z.object({ ...paginationBase });
const tagAliasesQuery = validateQuery(tagAliasesQuerySchema);

// GET /api/tag-aliases
router.get(
  '/',
  ...requirePermission('tags_manage'),
  tagAliasesQuery,
  asyncHandler(async (req, res) => {
    const pg = pageOf(tagAliasesQuery.read(res));
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
  createTagAliasBody,
  authHandler(async (req, res) => {
    const { badTag, goodTagId } = await prepareTagAlias(
      createTagAliasBody.read(res)
    );
    let alias;
    try {
      alias = await prisma.tagAlias.create({
        data: { badTag, goodTagId, createdById: req.user.id },
        include: {
          goodTag: { select: { id: true, name: true } },
          createdBy: { select: { id: true, username: true } }
        }
      });
    } catch (err) {
      // `TagAlias.badTag` is unique. `goodTagId` is read above and
      // `createdById` is session-derived, so P2002 is what remains (#564).
      translatePrismaError(err, {
        P2002: [409, 'That tag alias already exists']
      });
    }
    res.status(201).json(alias);
  })
);

// PUT /api/tag-aliases/:id
router.put(
  '/:id',
  ...requirePermission('tags_manage'),
  idParams,
  updateTagAliasBody,
  authHandler(async (req, res) => {
    const { id } = idParams.read(res);
    const existing = await prisma.tagAlias.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Tag alias not found');
    const { badTag, goodTagId } = await prepareTagAlias(
      updateTagAliasBody.read(res)
    );
    let alias;
    try {
      alias = await prisma.tagAlias.update({
        where: { id },
        data: { badTag, goodTagId },
        include: {
          goodTag: { select: { id: true, name: true } },
          createdBy: { select: { id: true, username: true } }
        }
      });
    } catch (err) {
      translatePrismaError(err, {
        P2025: [404, 'Tag alias not found'],
        P2002: [409, 'That tag alias already exists']
      });
    }
    res.json(alias);
  })
);

// DELETE /api/tag-aliases/:id
router.delete(
  '/:id',
  ...requirePermission('tags_manage'),
  idParams,
  asyncHandler(async (_req, res) => {
    const { id } = idParams.read(res);
    const existing = await prisma.tagAlias.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Tag alias not found');
    try {
      await prisma.tagAlias.delete({ where: { id } });
    } catch (err) {
      translatePrismaError(err, { P2025: [404, 'Tag alias not found'] });
    }
    res.status(204).send();
  })
);

export default router;
