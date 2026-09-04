import express from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { authHandler } from '../../../modules/asyncHandler';
import { deletePost, updatePost } from '../../../modules/forum';
import {
  replyToTopic,
  type TopicSessionActor
} from '../../../modules/topicSession';
import { requireAuth } from '../../../middleware/auth';
import {
  loadPermissions,
  hasPermission
} from '../../../middleware/permissions';
import {
  parsedBody,
  validate,
  validateParams,
  validateQuery,
  parsedParams
} from '../../../middleware/validate';
import { writeLimiter } from '../../../middleware/rateLimiter';
import {
  createPostSchema,
  updatePostSchema,
  type CreatePostInput,
  type UpdatePostInput
} from '../../../schemas/forum';
import {
  parsedPage,
  paginatedResponse,
  paginationBase
} from '../../../lib/pagination';
import { renderSiteBBCode } from '../../../modules/bbcodeRender';
import {
  publicPostInclude,
  serializeForumPost
} from '../../../modules/forumPostView';
import { assertForumReadAccess } from '../../../modules/forumAccess';

const router = express.Router({ mergeParams: true });
const forumTopicParamsSchema = z.object({
  forumId: z.coerce.number().int().positive(),
  topicId: z.coerce.number().int().positive()
});
const forumPostParamsSchema = z.object({
  forumId: z.coerce.number().int().positive(),
  topicId: z.coerce.number().int().positive(),
  id: z.coerce.number().int().positive()
});

const forumPostsQuerySchema = z.object({ ...paginationBase });

const editHistoryInclude = {
  edits: {
    orderBy: { editedAt: 'desc' as const },
    include: { editor: { select: { id: true, username: true } } }
  }
};

// GET /api/forums/:forumId/topics/:topicId/posts
router.get(
  '/',
  requireAuth,
  validateParams(forumTopicParamsSchema),
  validateQuery(forumPostsQuerySchema),
  authHandler(async (req, res) => {
    const { forumId, topicId } = parsedParams<{
      forumId: number;
      topicId: number;
    }>(res);

    await assertForumReadAccess(req.user, forumId);

    const pg = parsedPage(res);
    const [posts, total] = await Promise.all([
      prisma.forumPost.findMany({
        where: {
          forumTopicId: topicId,
          deletedAt: null,
          forumTopic: { forumId, deletedAt: null }
        },
        orderBy: { createdAt: 'asc' },
        skip: pg.skip,
        take: pg.limit,
        include: publicPostInclude
      }),
      prisma.forumPost.count({
        where: {
          forumTopicId: topicId,
          deletedAt: null,
          forumTopic: { forumId, deletedAt: null }
        }
      })
    ]);
    paginatedResponse(
      res,
      await Promise.all(posts.map((post) => serializeForumPost(post))),
      total,
      pg
    );
  })
);

// GET /api/forums/:forumId/topics/:topicId/posts/:id
router.get(
  '/:id',
  requireAuth,
  validateParams(forumPostParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, topicId, id } = parsedParams<{
      forumId: number;
      topicId: number;
      id: number;
    }>(res);

    await assertForumReadAccess(req.user, forumId);

    const post = await prisma.forumPost.findFirst({
      where: {
        id,
        forumTopicId: topicId,
        deletedAt: null,
        forumTopic: { forumId, deletedAt: null }
      },
      include: publicPostInclude
    });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    res.json(await serializeForumPost(post));
  })
);

// GET /api/forums/:forumId/topics/:topicId/posts/:id/edits — moderator only
router.get(
  '/:id/edits',
  requireAuth,
  validateParams(forumPostParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, topicId, id } = parsedParams<{
      forumId: number;
      topicId: number;
      id: number;
    }>(res);

    await assertForumReadAccess(req.user, forumId);
    if (!hasPermission(await loadPermissions(req, res), 'forums_moderate')) {
      return res
        .status(403)
        .json({ msg: 'Insufficient permission to view edit history' });
    }

    const post = await prisma.forumPost.findFirst({
      where: {
        id,
        forumTopicId: topicId,
        deletedAt: null,
        forumTopic: { forumId, deletedAt: null }
      },
      include: editHistoryInclude
    });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    res.json({ data: post.edits });
  })
);

// POST /api/forums/:forumId/topics/:topicId/posts
router.post(
  '/',
  requireAuth,
  writeLimiter,
  validateParams(forumTopicParamsSchema),
  validate(createPostSchema),
  authHandler(async (req, res) => {
    const { forumId, topicId } = parsedParams<{
      forumId: number;
      topicId: number;
    }>(res);
    const { body } = parsedBody<CreatePostInput>(res);

    const actor: TopicSessionActor = {
      actorId: req.user.id,
      userRankLevel: req.user.userRankLevel,
      permittedForumIds: req.user.permittedForumIds,
      canModerateForums: hasPermission(
        await loadPermissions(req, res),
        'forums_moderate'
      )
    };

    const post = await replyToTopic(forumId, topicId, actor, body);
    res
      .status(201)
      .json({ ...post, bodyHtml: await renderSiteBBCode(post.body) });
  })
);

// PUT /api/forums/:forumId/topics/:topicId/posts/:id — author or moderator
router.put(
  '/:id',
  requireAuth,
  validateParams(forumPostParamsSchema),
  validate(updatePostSchema),
  authHandler(async (req, res) => {
    const { forumId, topicId, id } = parsedParams<{
      forumId: number;
      topicId: number;
      id: number;
    }>(res);
    const { body } = parsedBody<UpdatePostInput>(res);

    const post = await prisma.forumPost.findFirst({
      where: {
        id,
        forumTopicId: topicId,
        deletedAt: null,
        forumTopic: { forumId, deletedAt: null }
      }
    });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    const isOwner = post.authorId === req.user.id;
    if (
      !isOwner &&
      !hasPermission(await loadPermissions(req, res), 'forums_moderate')
    )
      return res.status(403).json({ msg: 'Not authorized' });

    await updatePost(id, req.user.id, post.body, body, topicId);

    const updated = await prisma.forumPost.findFirst({
      where: {
        id,
        forumTopicId: topicId,
        deletedAt: null,
        forumTopic: { forumId, deletedAt: null }
      },
      include: publicPostInclude
    });
    if (!updated) return res.status(404).json({ msg: 'Post not found' });
    res.json(await serializeForumPost(updated));
  })
);

// DELETE /api/forums/:forumId/topics/:topicId/posts/:id — author or moderator
router.delete(
  '/:id',
  requireAuth,
  validateParams(forumPostParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, topicId, id } = parsedParams<{
      forumId: number;
      topicId: number;
      id: number;
    }>(res);
    const post = await prisma.forumPost.findFirst({
      where: {
        id,
        forumTopicId: topicId,
        deletedAt: null,
        forumTopic: { forumId, deletedAt: null }
      }
    });
    if (!post) return res.status(404).json({ msg: 'Post not found' });

    const isOwner = post.authorId === req.user.id;
    if (
      !isOwner &&
      !hasPermission(await loadPermissions(req, res), 'forums_moderate')
    ) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    await deletePost(id, topicId, forumId, req.user.id, !isOwner);
    res.status(204).send();
  })
);

export default router;
