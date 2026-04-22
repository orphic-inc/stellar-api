import express, { Request, Response } from 'express';
import { FileType } from '@prisma/client';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';
import { parsePage, paginatedResponse } from '../../../../lib/pagination';

const router = express.Router();

// GET /api/contributions
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const pg = parsePage(req);
    const [contributions, total] = await Promise.all([
      prisma.contribution.findMany({
        skip: pg.skip,
        take: pg.limit,
        include: {
          user: { select: { id: true, username: true } },
          release: { select: { id: true, title: true } },
          collaborators: { select: { id: true, name: true } }
        }
      }),
      prisma.contribution.count()
    ]);
    paginatedResponse(res, contributions, total, pg);
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
  asyncHandler(async (req: Request, res: Response) => {
    const {
      releaseId, contributorId, releaseDescription,
      type, sizeInBytes, jsonFile, collaboratorIds
    } = req.body as {
      releaseId: number; contributorId: number; releaseDescription?: string;
      type: FileType; sizeInBytes: number; jsonFile?: boolean;
      collaboratorIds?: number[];
    };

    if (!releaseId || !contributorId || !type || !sizeInBytes) {
      return res.status(400).json({ msg: 'releaseId, contributorId, type, and sizeInBytes are required' });
    }

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
