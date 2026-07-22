import express, { Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import {
  requirePermission,
  loadPermissions
} from '../../middleware/permissions';
import {
  validate,
  validateParams,
  validateQuery,
  parsedBody,
  parsedParams,
  parsedQuery
} from '../../middleware/validate';
import { sanitizePlain } from '../../lib/sanitize';
// Wiki bodies are stored as raw BBCode and transcribed at read time — the API is
// the single source of transcription (#398/#402). `withBodyHtml` attaches the
// cached, sanitized `bodyHtml` alongside the raw `body` so the editor round-trips
// the source and the view renders the HTML.
import { withBodyHtml } from '../../modules/bbcodeRender';
import { audit } from '../../lib/audit';
import {
  createWikiPageSchema,
  updateWikiPageSchema,
  wikiPageParamsSchema,
  wikiRevisionParamsSchema,
  wikiCompareQuerySchema,
  addAliasSchema,
  wikiSearchQuerySchema,
  normalizeSlug,
  type CreateWikiPageInput,
  type UpdateWikiPageInput,
  type AddAliasInput,
  type WikiSearchQuery,
  type WikiCompareQuery
} from '../../schemas/wiki';
import type { AuthenticatedRequest } from '../../types/auth';

const router = express.Router();

// ID of the root wiki article — protected from deletion
const INDEX_ARTICLE_ID = 1;

const PAGE_SELECT = {
  id: true,
  title: true,
  slug: true,
  revision: true,
  minReadLevel: true,
  minEditLevel: true,
  authorId: true,
  author: { select: { id: true, username: true } },
  createdAt: true,
  updatedAt: true,
  aliases: { select: { alias: true, userId: true, createdAt: true } }
} as const;

const PAGE_WITH_BODY_SELECT = { ...PAGE_SELECT, body: true } as const;

async function canRead(
  req: AuthenticatedRequest,
  res: Response,
  minReadLevel: number
): Promise<boolean> {
  if (minReadLevel === 0) return true;
  if (req.user.userRankLevel >= minReadLevel) return true;
  const perms = await loadPermissions(req, res);
  return !!(perms['wiki_manage'] || perms['admin'] || perms['staff']);
}

async function canEdit(
  req: AuthenticatedRequest,
  res: Response,
  minEditLevel: number
): Promise<boolean> {
  const perms = await loadPermissions(req, res);
  if (perms['wiki_manage'] || perms['admin'] || perms['staff']) return true;
  if (!perms['wiki_edit']) return false;
  return req.user.userRankLevel >= minEditLevel;
}

// ─── GET /api/wiki  (list / search / browse) ─────────────────────────────────
router.get(
  '/',
  requireAuth,
  validateQuery(wikiSearchQuerySchema),
  authHandler(async (req, res) => {
    const { q, type, order, way, page, limit } =
      parsedQuery<WikiSearchQuery>(res);
    const skip = (page - 1) * limit;
    const authReq = req as AuthenticatedRequest;

    // Pre-load permissions once; filter restricted pages in the DB query.
    const perms = await loadPermissions(authReq, res);
    const canSeeAll = !!(
      perms['wiki_manage'] ||
      perms['admin'] ||
      perms['staff']
    );

    const where: Prisma.WikiPageWhereInput = { deletedAt: null };

    if (!canSeeAll) {
      where.minReadLevel = { lte: authReq.user.userRankLevel };
    }

    if (q) {
      const terms = sanitizePlain(q).trim().split(/\s+/).filter(Boolean);
      if (terms.length > 0) {
        if (type === 'title') {
          where.AND = terms.map((t) => ({
            title: { contains: t, mode: 'insensitive' as const }
          }));
        } else if (type === 'body') {
          where.AND = terms.map((t) => ({
            body: { contains: t, mode: 'insensitive' as const }
          }));
        } else {
          where.AND = terms.map((t) => ({
            OR: [
              { title: { contains: t, mode: 'insensitive' as const } },
              { body: { contains: t, mode: 'insensitive' as const } }
            ]
          }));
        }
      }
    }

    const orderByField: Record<string, string> = {
      title: 'title',
      created: 'createdAt',
      edited: 'updatedAt'
    };
    const orderBy = {
      [orderByField[order] ?? 'title']: way
    } as Prisma.WikiPageOrderByWithRelationInput;

    const [rows, total] = await Promise.all([
      prisma.wikiPage.findMany({
        where,
        select: PAGE_SELECT,
        orderBy,
        skip,
        take: limit
      }),
      prisma.wikiPage.count({ where })
    ]);

    res.json({
      data: rows,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
    });
  })
);

// ─── GET /api/wiki/by-alias/:alias ───────────────────────────────────────────
router.get(
  '/by-alias/:alias',
  requireAuth,
  authHandler(async (req, res) => {
    const alias = normalizeSlug(req.params.alias);
    const record = await prisma.wikiAlias.findUnique({
      where: { alias },
      include: {
        page: { select: { ...PAGE_WITH_BODY_SELECT, deletedAt: true } }
      }
    });
    if (!record || record.page.deletedAt) {
      return res.status(404).json({ msg: 'Page not found' });
    }
    if (
      !(await canRead(
        req as AuthenticatedRequest,
        res,
        record.page.minReadLevel
      ))
    ) {
      return res
        .status(403)
        .json({ msg: 'Insufficient rank to view this page' });
    }
    res.json(await withBodyHtml(record.page));
  })
);

// ─── GET /api/wiki/:id ────────────────────────────────────────────────────────
router.get(
  '/:id',
  requireAuth,
  validateParams(wikiPageParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const page = await prisma.wikiPage.findFirst({
      where: { id, deletedAt: null },
      select: PAGE_WITH_BODY_SELECT
    });
    if (!page) return res.status(404).json({ msg: 'Page not found' });
    if (!(await canRead(req as AuthenticatedRequest, res, page.minReadLevel))) {
      return res
        .status(403)
        .json({ msg: 'Insufficient rank to view this page' });
    }
    res.json(await withBodyHtml(page));
  })
);

// ─── GET /api/wiki/:id/revisions ──────────────────────────────────────────────
// Requires canEdit (not just canRead) — revision history can expose restricted
// prior content — only users who can edit can access revision history.
router.get(
  '/:id/revisions',
  requireAuth,
  validateParams(wikiPageParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const page = await prisma.wikiPage.findFirst({
      where: { id, deletedAt: null },
      select: {
        minReadLevel: true,
        minEditLevel: true,
        revision: true,
        title: true
      }
    });
    if (!page) return res.status(404).json({ msg: 'Page not found' });

    if (!(await canRead(req as AuthenticatedRequest, res, page.minReadLevel))) {
      return res.status(404).json({ msg: 'Page not found' });
    }
    if (!(await canEdit(req as AuthenticatedRequest, res, page.minEditLevel))) {
      return res
        .status(403)
        .json({ msg: 'Insufficient permission to view revision history' });
    }

    const revisions = await prisma.wikiRevision.findMany({
      where: { pageId: id },
      select: {
        id: true,
        revision: true,
        title: true,
        authorId: true,
        author: { select: { id: true, username: true } },
        createdAt: true
      },
      orderBy: { revision: 'desc' }
    });
    res.json({ currentRevision: page.revision, revisions });
  })
);

// ─── GET /api/wiki/:id/revisions/:rev ─────────────────────────────────────────
// Requires canEdit — returns full body of a historical revision.
router.get(
  '/:id/revisions/:rev',
  requireAuth,
  validateParams(wikiRevisionParamsSchema),
  authHandler(async (req, res) => {
    const { id, rev } = parsedParams<{ id: number; rev: number }>(res);
    const page = await prisma.wikiPage.findFirst({
      where: { id, deletedAt: null },
      select: {
        minReadLevel: true,
        minEditLevel: true,
        revision: true,
        title: true,
        body: true,
        authorId: true,
        author: { select: { id: true, username: true } },
        updatedAt: true
      }
    });
    if (!page) return res.status(404).json({ msg: 'Page not found' });

    if (!(await canRead(req as AuthenticatedRequest, res, page.minReadLevel))) {
      return res.status(404).json({ msg: 'Page not found' });
    }
    if (!(await canEdit(req as AuthenticatedRequest, res, page.minEditLevel))) {
      return res
        .status(403)
        .json({ msg: 'Insufficient permission to view revision content' });
    }

    if (rev === page.revision) {
      return res.json({
        revision: page.revision,
        title: page.title,
        body: page.body,
        authorId: page.authorId,
        author: page.author,
        createdAt: page.updatedAt
      });
    }

    const historical = await prisma.wikiRevision.findUnique({
      where: { pageId_revision: { pageId: id, revision: rev } },
      include: { author: { select: { id: true, username: true } } }
    });
    if (!historical) return res.status(404).json({ msg: 'Revision not found' });
    res.json(historical);
  })
);

// ─── GET /api/wiki/:id/compare ────────────────────────────────────────────────
// Returns bodies for two revisions so the client can compute the diff.
// Requires canEdit. Params: ?old=N&new=M
router.get(
  '/:id/compare',
  requireAuth,
  validateParams(wikiPageParamsSchema),
  validateQuery(wikiCompareQuerySchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { old: oldRev, new: newRev } = parsedQuery<WikiCompareQuery>(res);

    if (oldRev >= newRev) {
      return res.status(400).json({ msg: '`old` must be less than `new`' });
    }

    const page = await prisma.wikiPage.findFirst({
      where: { id, deletedAt: null },
      select: {
        minReadLevel: true,
        minEditLevel: true,
        revision: true,
        title: true,
        body: true,
        authorId: true,
        updatedAt: true
      }
    });
    if (!page) return res.status(404).json({ msg: 'Page not found' });

    if (!(await canRead(req as AuthenticatedRequest, res, page.minReadLevel))) {
      return res.status(404).json({ msg: 'Page not found' });
    }
    if (!(await canEdit(req as AuthenticatedRequest, res, page.minEditLevel))) {
      return res
        .status(403)
        .json({ msg: 'Insufficient permission to compare revisions' });
    }

    const getBody = async (rev: number): Promise<string | null> => {
      if (rev === page.revision) return page.body;
      const r = await prisma.wikiRevision.findUnique({
        where: { pageId_revision: { pageId: id, revision: rev } },
        select: { body: true }
      });
      return r?.body ?? null;
    };

    const [oldBody, newBody] = await Promise.all([
      getBody(oldRev),
      getBody(newRev)
    ]);

    if (oldBody === null)
      return res.status(404).json({ msg: `Revision ${oldRev} not found` });
    if (newBody === null)
      return res.status(404).json({ msg: `Revision ${newRev} not found` });

    res.json({
      pageId: id,
      title: page.title,
      old: { revision: oldRev, body: oldBody },
      new: { revision: newRev, body: newBody }
    });
  })
);

// ─── POST /api/wiki  (create) ─────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  validate(createWikiPageSchema),
  authHandler(async (req, res) => {
    const input = parsedBody<CreateWikiPageInput>(res);
    const authReq = req as AuthenticatedRequest;
    const perms = await loadPermissions(authReq, res);
    const canManage = !!(
      perms['wiki_manage'] ||
      perms['admin'] ||
      perms['staff']
    );
    const canEditWiki = !!perms['wiki_edit'];

    if (!canManage && !canEditWiki) {
      return res.status(403).json({ msg: 'Permission denied' });
    }

    // prettier-ignore
    const minReadLevel = canManage ? (input.minReadLevel ?? 0) : 0;
    // prettier-ignore
    const minEditLevel = canManage ? (input.minEditLevel ?? 0) : 0;

    const title = sanitizePlain(input.title).trim();
    // Store raw BBCode; transcription + sanitization happen at read time (#398).
    const body = input.body;
    const slug = input.slug ? normalizeSlug(input.slug) : normalizeSlug(title);

    if (!slug)
      return res
        .status(400)
        .json({ msg: 'Could not derive a valid slug from title' });

    const existing = await prisma.wikiPage.findUnique({ where: { slug } });
    if (existing)
      return res
        .status(409)
        .json({ msg: 'A page with this slug already exists' });

    const page = await prisma.$transaction(async (tx) => {
      const created = await tx.wikiPage.create({
        data: {
          title,
          body,
          slug,
          minReadLevel,
          minEditLevel,
          authorId: authReq.user.id,
          revision: 1
        },
        select: PAGE_WITH_BODY_SELECT
      });
      await tx.wikiAlias.create({
        data: { alias: slug, pageId: created.id, userId: authReq.user.id }
      });
      await audit(tx, authReq.user.id, 'wiki.create', 'WikiPage', created.id, {
        title,
        slug
      });
      return created;
    });

    res.status(201).json(page);
  })
);

// ─── PUT /api/wiki/:id  (update) ──────────────────────────────────────────────
router.put(
  '/:id',
  requireAuth,
  validateParams(wikiPageParamsSchema),
  validate(updateWikiPageSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const input = parsedBody<UpdateWikiPageInput>(res);
    const authReq = req as AuthenticatedRequest;

    const page = await prisma.wikiPage.findFirst({
      where: { id, deletedAt: null },
      select: {
        title: true,
        body: true,
        revision: true,
        minReadLevel: true,
        minEditLevel: true,
        authorId: true,
        updatedAt: true
      }
    });
    if (!page) return res.status(404).json({ msg: 'Page not found' });

    if (!(await canEdit(authReq, res, page.minEditLevel))) {
      return res
        .status(403)
        .json({ msg: 'Insufficient permission to edit this page' });
    }

    const perms = await loadPermissions(authReq, res);
    const canManage = !!(
      perms['wiki_manage'] ||
      perms['admin'] ||
      perms['staff']
    );

    const title = input.title ? sanitizePlain(input.title).trim() : page.title;
    // Store raw BBCode; transcription + sanitization happen at read time (#398).
    const body = input.body ? input.body : page.body;
    const minReadLevel =
      canManage && input.minReadLevel !== undefined
        ? input.minReadLevel
        : page.minReadLevel;
    const minEditLevel =
      canManage && input.minEditLevel !== undefined
        ? input.minEditLevel
        : page.minEditLevel;

    const effectiveEditLevel = Math.max(minEditLevel, minReadLevel);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.wikiRevision.create({
        data: {
          pageId: id,
          revision: page.revision,
          title: page.title,
          body: page.body,
          authorId: page.authorId
        }
      });

      const result = await tx.wikiPage.update({
        where: { id },
        data: {
          title,
          body,
          revision: page.revision + 1,
          minReadLevel,
          minEditLevel: effectiveEditLevel,
          authorId: authReq.user.id
        },
        select: PAGE_WITH_BODY_SELECT
      });

      await audit(tx, authReq.user.id, 'wiki.edit', 'WikiPage', id, {
        revision: result.revision,
        title
      });
      return result;
    });

    res.json(updated);
  })
);

// ─── DELETE /api/wiki/:id ─────────────────────────────────────────────────────
router.delete(
  '/:id',
  ...requirePermission('wiki_manage', 'admin'),
  validateParams(wikiPageParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);

    if (id === INDEX_ARTICLE_ID) {
      return res
        .status(400)
        .json({ msg: 'Cannot delete the main wiki article' });
    }

    const page = await prisma.wikiPage.findFirst({
      where: { id, deletedAt: null },
      select: { title: true }
    });
    if (!page) return res.status(404).json({ msg: 'Page not found' });

    await prisma.$transaction(async (tx) => {
      await tx.wikiPage.update({
        where: { id },
        data: { deletedAt: new Date() }
      });
      await audit(
        tx,
        (req as AuthenticatedRequest).user.id,
        'wiki.delete',
        'WikiPage',
        id,
        { title: page.title }
      );
    });

    res.status(204).send();
  })
);

// ─── POST /api/wiki/:id/aliases ───────────────────────────────────────────────
router.post(
  '/:id/aliases',
  requireAuth,
  validateParams(wikiPageParamsSchema),
  validate(addAliasSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { alias: rawAlias } = parsedBody<AddAliasInput>(res);
    const authReq = req as AuthenticatedRequest;

    const page = await prisma.wikiPage.findFirst({
      where: { id, deletedAt: null },
      select: { minEditLevel: true }
    });
    if (!page) return res.status(404).json({ msg: 'Page not found' });
    if (!(await canEdit(authReq, res, page.minEditLevel))) {
      return res
        .status(403)
        .json({ msg: 'Insufficient permission to edit this page' });
    }

    const alias = normalizeSlug(rawAlias);
    if (!alias) return res.status(400).json({ msg: 'Invalid alias' });

    const existing = await prisma.wikiAlias.findUnique({ where: { alias } });
    if (existing) return res.status(409).json({ msg: 'Alias already in use' });

    await prisma.wikiAlias.create({
      data: { alias, pageId: id, userId: authReq.user.id }
    });
    res.status(201).json({ alias });
  })
);

// ─── DELETE /api/wiki/:id/aliases/:alias ──────────────────────────────────────
router.delete(
  '/:id/aliases/:alias',
  requireAuth,
  validateParams(wikiPageParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const alias = normalizeSlug(req.params.alias);
    const authReq = req as AuthenticatedRequest;

    const page = await prisma.wikiPage.findFirst({
      where: { id, deletedAt: null },
      select: { minEditLevel: true, slug: true }
    });
    if (!page) return res.status(404).json({ msg: 'Page not found' });
    if (!(await canEdit(authReq, res, page.minEditLevel))) {
      return res
        .status(403)
        .json({ msg: 'Insufficient permission to edit this page' });
    }
    if (alias === page.slug) {
      return res
        .status(400)
        .json({ msg: 'Cannot remove the primary slug alias' });
    }

    const record = await prisma.wikiAlias.findUnique({ where: { alias } });
    if (!record || record.pageId !== id) {
      return res.status(404).json({ msg: 'Alias not found on this page' });
    }

    await prisma.wikiAlias.delete({ where: { alias } });
    res.status(204).send();
  })
);

// ─── POST /api/wiki/:id/rollback/:rev ─────────────────────────────────────────
router.post(
  '/:id/rollback/:rev',
  requireAuth,
  validateParams(wikiRevisionParamsSchema),
  authHandler(async (req, res) => {
    const { id, rev } = parsedParams<{ id: number; rev: number }>(res);
    const authReq = req as AuthenticatedRequest;

    const page = await prisma.wikiPage.findFirst({
      where: { id, deletedAt: null },
      select: {
        title: true,
        body: true,
        revision: true,
        minEditLevel: true,
        authorId: true
      }
    });
    if (!page) return res.status(404).json({ msg: 'Page not found' });
    if (!(await canEdit(authReq, res, page.minEditLevel))) {
      return res
        .status(403)
        .json({ msg: 'Insufficient permission to edit this page' });
    }

    const target = await prisma.wikiRevision.findUnique({
      where: { pageId_revision: { pageId: id, revision: rev } }
    });
    if (!target) return res.status(404).json({ msg: 'Revision not found' });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.wikiRevision.create({
        data: {
          pageId: id,
          revision: page.revision,
          title: page.title,
          body: page.body,
          authorId: page.authorId
        }
      });

      const result = await tx.wikiPage.update({
        where: { id },
        data: {
          title: target.title,
          body: target.body,
          revision: page.revision + 1,
          authorId: authReq.user.id
        },
        select: PAGE_WITH_BODY_SELECT
      });

      await audit(tx, authReq.user.id, 'wiki.rollback', 'WikiPage', id, {
        toRevision: rev,
        newRevision: result.revision
      });
      return result;
    });

    res.json(updated);
  })
);

export default router;
