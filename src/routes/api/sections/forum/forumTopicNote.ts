import express, { Request, Response } from 'express';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';
import { validate } from '../../../../middleware/validate';
import { topicNoteSchema } from '../../../../schemas/poll';

const router = express.Router();

// GET /api/forums/topic-notes/:topicId
router.get(
  '/:topicId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const forumTopicId = parseInt(req.params.topicId);
    if (isNaN(forumTopicId)) return res.status(400).json({ msg: 'Invalid topic id' });
    const notes = await prisma.forumTopicNote.findMany({
      where: { forumTopicId },
      include: { author: { select: { id: true, username: true } } }
    });
    res.json(notes);
  })
);

// POST /api/forums/topic-notes
router.post(
  '/',
  requireAuth,
  validate(topicNoteSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { forumTopicId, body } = req.body as { forumTopicId: number; body: string };
    const note = await prisma.forumTopicNote.create({
      data: { forumTopicId, authorId: req.user!.id, body }
    });
    res.status(201).json(note);
  })
);

// DELETE /api/forums/topic-notes/:id
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const note = await prisma.forumTopicNote.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ msg: 'Note not found' });
    if (note.authorId !== req.user!.id) return res.status(403).json({ msg: 'Not authorized' });
    await prisma.forumTopicNote.delete({ where: { id } });
    res.json({ msg: 'Note removed' });
  })
);

export default router;
