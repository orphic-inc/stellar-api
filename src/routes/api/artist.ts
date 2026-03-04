import express, { Request, Response } from 'express';
import { check, validationResult } from 'express-validator';
import { asyncHandler } from '../../modules/asyncHandler.js';
import { prisma } from '../../modules/prisma.js';
import { authenticate } from '../../middleware/auth.js';

const router = express.Router();

// @route   GET /api/artist
// @desc    Get all artists
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const artists = await prisma.artist.findMany({
      include: { histories: true }
    });
    res.json(artists);
  })
);

// @route   GET /api/artist/:id
// @desc    Get artist by ID
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const artist = await prisma.artist.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { histories: true, releases: true }
    });

    if (!artist) {
      return res.status(404).json({ msg: 'Artist not found' });
    }

    res.json(artist);
  })
);

// @route   POST /api/artist
// @desc    Create an artist
router.post(
  '/',
  authenticate,
  [check('name', 'Name is required').not().isEmpty()],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, vanityHouse } = req.body;

    const artist = await prisma.artist.create({
      data: { name, vanityHouse: vanityHouse || false }
    });

    res.status(201).json(artist);
  })
);

// @route   PUT /api/artist/:id
// @desc    Update an artist
router.put(
  '/:id',
  authenticate,
  [check('name', 'Name is required').not().isEmpty()],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, vanityHouse } = req.body;

    const artist = await prisma.artist.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!artist) {
      return res.status(404).json({ msg: 'Artist not found' });
    }

    const updated = await prisma.artist.update({
      where: { id: parseInt(req.params.id) },
      data: { name, vanityHouse }
    });

    res.json(updated);
  })
);

// @route   DELETE /api/artist/:id
// @desc    Delete an artist
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const artist = await prisma.artist.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!artist) {
      return res.status(404).json({ msg: 'Artist not found' });
    }

    await prisma.artist.delete({
      where: { id: parseInt(req.params.id) }
    });

    res.json({ msg: 'Artist deleted' });
  })
);

export default router;
