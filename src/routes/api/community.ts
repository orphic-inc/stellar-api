import express, { Request, Response } from 'express';
import { check, validationResult } from 'express-validator';
import { asyncHandler } from '../../modules/asyncHandler.js';
import { prisma } from '../../modules/prisma.js';
import { authenticate } from '../../middleware/auth.js';

const router = express.Router();

// @route   GET /api/community
// @desc    Get all communities
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const communities = await prisma.community.findMany();
    res.json(communities);
  })
);

// @route   GET /api/community/:id
// @desc    Get community by ID
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const community = await prisma.community.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { releases: true }
    });

    if (!community) {
      return res.status(404).json({ msg: 'Community not found' });
    }

    res.json(community);
  })
);

// @route   POST /api/community
// @desc    Create a community
router.post(
  '/',
  authenticate,
  [
    check('name', 'Name is required').not().isEmpty(),
    check('image', 'Image URL is required').not().isEmpty(),
    check('type', 'Community type is required').not().isEmpty(),
    check('registrationStatus', 'Registration status is required')
      .not()
      .isEmpty()
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, image, type, registrationStatus } = req.body;

    const community = await prisma.community.create({
      data: { name, image, type, registrationStatus }
    });

    res.status(201).json(community);
  })
);

// @route   PUT /api/community/:id
// @desc    Update a community
router.put(
  '/:id',
  authenticate,
  [check('name', 'Name is required').not().isEmpty()],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, image, type, registrationStatus } = req.body;

    const community = await prisma.community.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!community) {
      return res.status(404).json({ msg: 'Community not found' });
    }

    const updated = await prisma.community.update({
      where: { id: parseInt(req.params.id) },
      data: { name, image, type, registrationStatus }
    });

    res.json(updated);
  })
);

// @route   DELETE /api/community/:id
// @desc    Delete a community
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const community = await prisma.community.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!community) {
      return res.status(404).json({ msg: 'Community not found' });
    }

    await prisma.community.delete({
      where: { id: parseInt(req.params.id) }
    });

    res.json({ msg: 'Community deleted' });
  })
);

export default router;
