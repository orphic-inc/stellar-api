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
  validate,
  validateParams,
  validateQuery
} from '../../../middleware/validate';
import { createTopicSchema, updateTopicSchema } from '../../../schemas/forum';
import {
  paginatedResponse,
  paginationBase,
  pageOf
} from '../../../lib/pagination';
import { prisma } from '../../../lib/prisma';
import { sanitizePlain } from '../../../lib/sanitize';
import { canAccessForumLevel } from '../../../lib/userRankAccess';
import { authorRefSelect, toAuthorRefOrNull } from '../../../modules/authorRef';
import forumPostRouter from './forumPost';
import { assertForumReadAccess } from '../../../modules/forumAccess';
import { resolveViewer } from '../../../modules/bbcodeRender';

const router = express.Router({ mergeParams: true });
const updateTopicBody = validate(updateTopicSchema);
const createTopicBody = validate(createTopicSchema);
const forumIdParamsSchema = z.object({
  forumId: z.coerce.number().int().positive()
});
const forumIdParams = validateParams(forumIdParamsSchema);
const forumTopicParamsSchema = z.object({
  forumId: z.coerce.number().int().positive(),
  topicId: z.coerce.number().int().positive()
});
const forumTopicParams = validateParams(forumTopicParamsSchema);

router.use('/:topicId/posts', forumPostRouter);

const forumTopicsQuerySchema = z.object({ ...paginationBase });
const forumTopicsQuery = validateQuery(forumTopicsQuerySchema);

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
  forumIdParams,
  forumTopicsQuery,
  authHandler(async (req, res) => {
    const { forumId } = forumIdParams.read(res);

    await assertForumReadAccess(req.user, forumId);

    const pg = pageOf(forumTopicsQuery.read(res));
    const [topics, total] = await Promise.all([
      prisma.forumTopic.findMany({
        where: { forumId, deletedAt: null },
        orderBy: [{ isSticky: 'desc' }, { updatedAt: 'desc' }],
        skip: pg.skip,
        take: pg.limit,
        include: {
          author: { select: authorRefSelect },
          // Unfiltered, this spread the deleted post's whole row at the mapper
          // below — `body` included, since `deletePost` keeps it verbatim
          // (#598). The pointer recompute keeps this correct going forward;
          // the filter covers rows already stale in a deployed database.
          lastPost: {
            where: { deletedAt: null },
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

// ─── GET /api/forums/:forumId/topics/:topicId/session ───────────────────
// Registered before /:topicId so the static "/session" segment takes
// priority over the parameterized single-topic route.

router.get(
  '/:topicId/session',
  requireAuth,
  forumTopicParams,
  forumTopicsQuery,
  authHandler(async (req, res) => {
    const { forumId, topicId } = forumTopicParams.read(res);
    const pg = pageOf(forumTopicsQuery.read(res));
    const actor = await buildActor(req, res);

    const session = await getTopicSession(
      forumId,
      topicId,
      actor,
      pg,
      await resolveViewer(req)
    );
    res.json(session);
  })
);

// ─── GET /api/forums/:forumId/topics/:topicId ───────────────────────────

router.get(
  '/:topicId',
  requireAuth,
  forumTopicParams,
  authHandler(async (req, res) => {
    const { forumId, topicId: id } = forumTopicParams.read(res);
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
  forumIdParams,
  createTopicBody,
  authHandler(async (req, res) => {
    const { forumId } = forumIdParams.read(res);
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

    const { title, body, question, answers } = createTopicBody.read(res);
    const topic = await createTopic(forumId, req.user.id, {
      title: sanitizePlain(title),
      body,
      question,
      answers
    });
    res.status(201).json(topic);
  })
);

// ─── PUT /api/forums/:forumId/topics/:topicId ───────────────────────────

router.put(
  '/:topicId',
  requireAuth,
  forumTopicParams,
  updateTopicBody,
  authHandler(async (req, res) => {
    const { forumId, topicId: id } = forumTopicParams.read(res);
    const { title, isLocked, isSticky } = updateTopicBody.read(res);
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

// ─── DELETE /api/forums/:forumId/topics/:topicId ────────────────────────

router.delete(
  '/:topicId',
  requireAuth,
  forumTopicParams,
  authHandler(async (req, res) => {
    const { forumId, topicId: id } = forumTopicParams.read(res);
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

// ─── POST /api/forums/:forumId/topics/:topicId/trash ────────────────────

router.post(
  '/:topicId/trash',
  requireAuth,
  forumTopicParams,
  authHandler(async (req, res) => {
    const { forumId, topicId: id } = forumTopicParams.read(res);
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
