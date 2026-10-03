import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { translatePrismaError } from '../../../lib/prismaErrors';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { createTopicNote } from '../../../modules/forum';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import { validate, validateParams } from '../../../middleware/validate';
import { topicNoteSchema } from '../../../schemas/forum';

const router = express.Router();
const topicNoteBody = validate(topicNoteSchema);
const topicIdParamsSchema = z.object({
  topicId: z.coerce.number().int().positive()
});
const topicIdParams = validateParams(topicIdParamsSchema);
const noteIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});
const noteIdParams = validateParams(noteIdParamsSchema);

// GET /api/forums/topic-notes/:topicId — moderators only
router.get(
  '/:topicId',
  ...requirePermission('forums_moderate'),
  topicIdParams,
  asyncHandler(async (req: Request, res: Response) => {
    const { topicId: forumTopicId } = topicIdParams.read(res);
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
  topicNoteBody,
  authHandler(async (req, res) => {
    const { forumTopicId, body } = topicNoteBody.read(res);
    const note = await createTopicNote(forumTopicId, req.user.id, body);
    res.status(201).json(note);
  })
);

// DELETE /api/forums/topic-notes/:id — author only
router.delete(
  '/:id',
  requireAuth,
  noteIdParams,
  authHandler(async (req, res) => {
    const { id } = noteIdParams.read(res);
    const note = await prisma.forumTopicNote.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ msg: 'Note not found' });
    if (note.authorId !== req.user.id)
      return res.status(403).json({ msg: 'Not authorized' });
    try {
      await prisma.forumTopicNote.delete({ where: { id } });
    } catch (err) {
      // The note was read and authorised above; this covers its removal in
      // between, which would otherwise be a 500 (#564, arm B).
      translatePrismaError(err, { P2025: [404, 'Note not found'] });
    }
    res.status(204).send();
  })
);

export default router;
