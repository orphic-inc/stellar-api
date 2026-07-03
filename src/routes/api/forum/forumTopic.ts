import express from 'express';
import { z } from 'zod';
import { authHandler } from '../../../modules/asyncHandler';
import {
  getTopicSession,
  updateTopic,
  deleteTopic,
  trashTopic,
  type TopicSessionActor
} from '../../../modules/topicSession';
import { createTopic } from '../../../modules/forum';
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
  createTopicSchema,
  updateTopicSchema,
  type CreateTopicInput,
  type UpdateTopicInput
} from '../../../schemas/forum';
import {
  parsedPage,
  paginatedResponse,
  paginationBase
} from '../../../lib/pagination';
import { prisma } from '../../../lib/prisma';
import { sanitizePlain } from '../../../lib/sanitize';
import { canAccessForumLevel } from '../../../lib/userRankAccess';
import { authorRefSelect, toAuthorRefOrNull } from '../../../modules/authorRef';
import forumPostRouter from './forumPost';

const router = express.Router({ mergeParams: true });
const forumIdParamsSchema = z.object({
  forumId: z.coerce.number().int().positive()
});
const forumTopicParamsSchema = z.object({
  forumId: z.coerce.number().int().positive(),
  forumTopicId: z.coerce.number().int().positive()
});

router.use('/:forumTopicId/posts', forumPostRouter);

const forumTopicsQuerySchema = z.object({ ...paginationBase });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derives a narrow actor from the authenticated request. */
const buildActor = async (
  req: Parameters<Parameters<typeof authHandler>[0]>[0],
  res: Parameters<Parameters<typeof authHandler>[0]>[1],
  _canMod?: boolean
): Promise<TopicSessionActor> => ({
  actorId: req.user.id,
  userRankLevel: req.user.userRankLevel,
  permittedForumIds: req.user.permittedForumIds,
  canModerateForums: hasPermission(
    await loadPermissions(req, res),
    'forums_moderate'
  )
});

// ─── GET /api/forums/:forumId/topics ─────────────────────────────────────────

router.get(
  '/',
  requireAuth,
  validateParams(forumIdParamsSchema),
  validateQuery(forumTopicsQuerySchema),
  authHandler(async (req, res) => {
    const { forumId } = parsedParams<{ forumId: number }>(res);

    const forum = await prisma.forum.findUnique({
      where: { id: forumId },
      select: { minClassRead: true }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (!canAccessForumLevel(req.user, forumId, forum.minClassRead)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to read this forum' });
    }

    const pg = parsedPage(res);
    const [topics, total] = await Promise.all([
      prisma.forumTopic.findMany({
        where: { forumId, deletedAt: null },
        orderBy: [{ isSticky: 'desc' }, { updatedAt: 'desc' }],
        skip: pg.skip,
        take: pg.limit,
        include: {
          author: { select: authorRefSelect },
          lastPost: {
            include: { author: { select: authorRefSelect } }
          }
        }
      }),
      prisma.forumTopic.count({ where: { forumId, deletedAt: null } })
    ]);
    const mapped = topics.map((topic) => ({
      ...topic,
      author: toAuthorRefOrNull(topic.author),
      lastPost: topic.lastPost
        ? {
            ...topic.lastPost,
            author: toAuthorRefOrNull(topic.lastPost.author)
          }
        : null
    }));
    paginatedResponse(res, mapped, total, pg);
  })
);

// ─── GET /api/forums/:forumId/topics/:forumTopicId/session ───────────────────
// Registered before /:forumTopicId so the static "/session" segment takes
// priority over the parameterized single-topic route.

router.get(
  '/:forumTopicId/session',
  requireAuth,
  validateParams(forumTopicParamsSchema),
  validateQuery(forumTopicsQuerySchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId: topicId } = parsedParams<{
      forumId: number;
      forumTopicId: number;
    }>(res);
    const pg = parsedPage(res);
    const actor = await buildActor(req, res);

    const session = await getTopicSession(forumId, topicId, actor, pg);
    res.json(session);
  })
);

// ─── GET /api/forums/:forumId/topics/:forumTopicId ───────────────────────────

router.get(
  '/:forumTopicId',
  requireAuth,
  validateParams(forumTopicParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId: id } = parsedParams<{
      forumId: number;
      forumTopicId: number;
    }>(res);
    const [forum, topic] = await Promise.all([
      prisma.forum.findUnique({
        where: { id: forumId },
        select: { minClassRead: true }
      }),
      prisma.forumTopic.findFirst({
        where: { id, forumId, deletedAt: null },
        include: {
          author: { select: authorRefSelect },
          notes: {
            include: { author: { select: { id: true, username: true } } }
          }
        }
      })
    ]);
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (!canAccessForumLevel(req.user, forumId, forum.minClassRead)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to read this forum' });
    }
    if (!topic) return res.status(404).json({ msg: 'Topic not found' });
    res.json({ ...topic, author: toAuthorRefOrNull(topic.author) });
  })
);

// ─── POST /api/forums/:forumId/topics ────────────────────────────────────────

router.post(
  '/',
  requireAuth,
  writeLimiter,
  validateParams(forumIdParamsSchema),
  validate(createTopicSchema),
  authHandler(async (req, res) => {
    const { forumId } = parsedParams<{ forumId: number }>(res);
    const forum = await prisma.forum.findUnique({
      where: { id: forumId },
      select: { id: true, minClassCreate: true }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (!canAccessForumLevel(req.user, forumId, forum.minClassCreate)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to create topics in this forum' });
    }

    const { title, body, question, answers } =
      parsedBody<CreateTopicInput>(res);
    const topic = await createTopic(forumId, req.user.id, {
      title: sanitizePlain(title),
      body,
      question,
      answers
    });
    res.status(201).json(topic);
  })
);

// ─── PUT /api/forums/:forumId/topics/:forumTopicId ───────────────────────────

router.put(
  '/:forumTopicId',
  requireAuth,
  validateParams(forumTopicParamsSchema),
  validate(updateTopicSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId: id } = parsedParams<{
      forumId: number;
      forumTopicId: number;
    }>(res);
    const { title, isLocked, isSticky } = parsedBody<UpdateTopicInput>(res);
    const actor = await buildActor(req, res);

    const result = await updateTopic(id, forumId, actor, {
      title,
      isLocked,
      isSticky
    });
    if (!result.ok) {
      if (result.reason === 'not_found')
        return res.status(404).json({ msg: 'Topic not found' });
      return res.status(403).json({ msg: 'Not authorized' });
    }
    res.json(result.topic);
  })
);

// ─── DELETE /api/forums/:forumId/topics/:forumTopicId ────────────────────────

router.delete(
  '/:forumTopicId',
  requireAuth,
  validateParams(forumTopicParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId: id } = parsedParams<{
      forumId: number;
      forumTopicId: number;
    }>(res);
    const actor = await buildActor(req, res);

    const result = await deleteTopic(id, forumId, actor);
    if (!result.ok) {
      if (result.reason === 'not_found')
        return res.status(404).json({ msg: 'Topic not found' });
      return res.status(403).json({ msg: 'Not authorized' });
    }
    res.status(204).send();
  })
);

// ─── POST /api/forums/:forumId/topics/:forumTopicId/trash ────────────────────

router.post(
  '/:forumTopicId/trash',
  requireAuth,
  validateParams(forumTopicParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId: id } = parsedParams<{
      forumId: number;
      forumTopicId: number;
    }>(res);
    const actor = await buildActor(req, res);

    const result = await trashTopic(id, forumId, actor);
    if (!result.ok) {
      if (result.reason === 'not_authorized')
        return res.status(403).json({ msg: 'Not authorized' });
      if (result.reason === 'not_found')
        return res.status(404).json({ msg: 'Topic not found' });
      const msg =
        result.reason === 'no_trash'
          ? 'No trash board is configured'
          : 'Topic is already in the trash board';
      return res.status(400).json({ msg });
    }
    res.json(result.topic);
  })
);

export default router;
