import express, { Request, Response } from 'express';
import { check, validationResult } from 'express-validator';
import { asyncHandler } from '../../modules/asyncHandler.js';
import { prisma } from '../../modules/prisma.js';
import { authenticate } from '../../middleware/auth.js';

const router = express.Router();

// @route   GET /api/release
// @desc    Get all releases
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const releases = await prisma.release.findMany({
      include: { artist: true, tags: true }
    });
    res.json(releases);
  })
);

// @route   GET /api/release/:id
// @desc    Get release by ID
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const release = await prisma.release.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { artist: true, tags: true, contributions: true }
    });

    if (!release) {
      return res.status(404).json({ msg: 'Release not found' });
    }

    res.json(release);
  })
);

// @route   POST /api/release
// @desc    Create a release
router.post(
  '/',
  authenticate,
  [
    check('title', 'Title is required').not().isEmpty(),
    check('title', 'Title must be at most 100 characters').isLength({
      max: 100
    }),
    check('description', 'Description is required').not().isEmpty(),
    check(
      'description',
      'Description must be at most 1000 characters'
    ).isLength({ max: 1000 }),
    check('artistId', 'Artist ID is required').isInt(),
    check('type', 'Release type is required').not().isEmpty(),
    check('releaseType', 'Release category is required').not().isEmpty(),
    check('year', 'Year is required').isInt()
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title,
      description,
      artistId,
      type,
      releaseType,
      year,
      image,
      communityId
    } = req.body;

    const release = await prisma.release.create({
      data: {
        title,
        description,
        artistId,
        type,
        releaseType,
        year,
        image,
        communityId
      }
    });

    res.status(201).json(release);
  })
);

// @route   PUT /api/release/:id
// @desc    Update a release
router.put(
  '/:id',
  authenticate,
  [
    check('title', 'Title must be at most 100 characters')
      .optional()
      .isLength({ max: 100 }),
    check('description', 'Description must be at most 1000 characters')
      .optional()
      .isLength({ max: 1000 })
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const release = await prisma.release.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!release) {
      return res.status(404).json({ msg: 'Release not found' });
    }

    const { title, description, image, type, releaseType, year } = req.body;

    const updated = await prisma.release.update({
      where: { id: parseInt(req.params.id) },
      data: { title, description, image, type, releaseType, year }
    });

    res.json(updated);
  })
);

// @route   DELETE /api/release/:id
// @desc    Delete a release
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const release = await prisma.release.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!release) {
      return res.status(404).json({ msg: 'Release not found' });
    }

    await prisma.release.delete({
      where: { id: parseInt(req.params.id) }
    });

    res.json({ msg: 'Release deleted' });
  })
);

export default router;
