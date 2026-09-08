import express, { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { AppError } from '../../../lib/errors';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { createTopicNote } from '../../../modules/forum';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import {
  parsedBody,
  validate,
  validateParams,
  parsedParams
} from '../../../middleware/validate';
import { topicNoteSchema, type TopicNoteInput } from '../../../schemas/forum';

const router = express.Router();
const topicIdParamsSchema = z.object({
  topicId: z.coerce.number().int().positive()
});
const noteIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/forums/topic-notes/:topicId — moderators only
router.get(
  '/:topicId',
  ...requirePermission('forums_moderate'),
  validateParams(topicIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { topicId: forumTopicId } = parsedParams<{
      topicId: number;
    }>(res);
    const notes = await prisma.forumTopicNote.findMany({
      where: { forumTopicId },
      include: { author: { select: { id: true, username: true } } }
    });
    res.json(notes);
  })
);

// POST /api/forums/topic-notes — moderators only
router.post(
  '/',
  ...requirePermission('forums_moderate'),
  validate(topicNoteSchema),
  authHandler(async (req, res) => {
    const { forumTopicId, body } = parsedBody<TopicNoteInput>(res);
    const note = await createTopicNote(forumTopicId, req.user.id, body);
    res.status(201).json(note);
  })
);

// DELETE /api/forums/topic-notes/:id — author only
router.delete(
  '/:id',
  requireAuth,
  validateParams(noteIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const note = await prisma.forumTopicNote.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ msg: 'Note not found' });
    if (note.authorId !== req.user.id)
      return res.status(403).json({ msg: 'Not authorized' });
    try {
      await prisma.forumTopicNote.delete({ where: { id } });
    } catch (err) {
      // The note was read and authorised above; this covers its removal in
      // between, which would otherwise be a 500 (#564, arm B).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new AppError(404, 'Note not found');
      }
      throw err;
    }
    res.status(204).send();
  })
);

export default router;
