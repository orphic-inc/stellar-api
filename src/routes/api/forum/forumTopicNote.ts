import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { isModerator } from '../../../middleware/permissions';
import { validate, validateParams } from '../../../middleware/validate';
import { topicNoteSchema, type TopicNoteInput } from '../../../schemas/forum';

const router = express.Router();
const topicIdParamsSchema = z.object({
  topicId: z.coerce.number().int().positive()
});
const noteIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

const requireModerator = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (await isModerator(req, res)) return next();
  res.status(403).json({ msg: 'Not authorized' });
};

// GET /api/forums/topic-notes/:topicId — moderators only
router.get(
  '/:topicId',
  requireAuth,
  requireModerator,
  validateParams(topicIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { topicId: forumTopicId } = req.params as unknown as {
      topicId: number;
    };
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
  requireAuth,
  requireModerator,
  validate(topicNoteSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { forumTopicId, body } = req.body as TopicNoteInput;
    const note = await prisma.forumTopicNote.create({
      data: { forumTopicId, authorId: req.user!.id, body }
    });
    res.status(201).json(note);
  })
);

// DELETE /api/forums/topic-notes/:id — author only
router.delete(
  '/:id',
  requireAuth,
  validateParams(noteIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as unknown as { id: number };
    const note = await prisma.forumTopicNote.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ msg: 'Note not found' });
    if (note.authorId !== req.user!.id)
      return res.status(403).json({ msg: 'Not authorized' });
    await prisma.forumTopicNote.delete({ where: { id } });
    res.json({ msg: 'Note removed' });
  })
);

export default router;
