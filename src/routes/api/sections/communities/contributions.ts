import express, { Request, Response } from 'express';
import { check, validationResult } from 'express-validator';
import { FileType } from '@prisma/client';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';

const router = express.Router();

// GET /api/contributions
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const contributions = await prisma.contribution.findMany({
      include: {
        user: { select: { id: true, username: true } },
        release: { select: { id: true, title: true } },
        collaborators: { select: { id: true, name: true } }
      }
    });
    res.json(contributions);
  })
);

// GET /api/contributions/:id
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const contribution = await prisma.contribution.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true } },
        release: true,
        collaborators: true,
        comments: { include: { author: { select: { id: true, username: true, avatar: true } } } }
      }
    });
    if (!contribution) return res.status(404).json({ msg: 'Contribution not found' });
    res.json(contribution);
  })
);

// POST /api/contributions
router.post(
  '/',
  requireAuth,
  [
    check('releaseId', 'Release id is required').isInt(),
    check('contributorId', 'Contributor id is required').isInt(),
    check('type', 'Type is required').not().isEmpty(),
    check('sizeInBytes', 'Size is required').isInt()
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      releaseId, contributorId, releaseDescription,
      type, sizeInBytes, jsonFile, collaboratorIds
    } = req.body as {
      releaseId: number; contributorId: number; releaseDescription?: string;
      type: FileType; sizeInBytes: number; jsonFile?: boolean;
      collaboratorIds?: number[];
    };

    const contribution = await prisma.contribution.create({
      data: {
        userId: req.user!.id,
        releaseId,
        contributorId,
        releaseDescription,
        type,
        sizeInBytes,
        jsonFile: jsonFile ?? false,
        ...(collaboratorIds?.length && {
          collaborators: { connect: collaboratorIds.map((id) => ({ id })) }
        })
      },
      include: { release: true, collaborators: true }
    });
    res.json(contribution);
  })
);

export default router;
