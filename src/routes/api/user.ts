import express, { Request, Response } from 'express';
import gravatar from 'gravatar';
import bcrypt from 'bcryptjs';
import { check, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import { asyncHandler } from '../../modules/asyncHandler.js';
import { prisma } from '../../modules/prisma.js';
import { auth } from '../../modules/config.js';

const router = express.Router();

interface UserPayload {
  user: {
    id: number;
  };
}

// @route   POST /api/user
// @desc    Register user
router.post(
  '/',
  [
    check('username', 'Name is required').not().isEmpty(),
    check('email', 'Please include a valid email').isEmail(),
    check(
      'password',
      'Please enter a password with 6 or more characters'
    ).isLength({ min: 6 })
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      return res
        .status(400)
        .json({ errors: [{ msg: 'User already exists' }] });
    }

    const avatar = gravatar.url(email, {
      s: '200',
      r: 'pg',
      d: 'mm'
    });

    const defaultRank = await prisma.userRank.findFirst({
      where: { level: 100 }
    });

    if (!defaultRank) {
      throw new Error('Default rank not found');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        avatar,
        userRank: { connect: { id: defaultRank.id } },
        userSettings: { create: {} },
        profile: { create: {} },
        communityPass: ''
      }
    });

    const payload: UserPayload = { user: { id: user.id } };

    const token = jwt.sign(payload, auth.jwtSecret as string, {
      expiresIn: 3600
    });
    res.json({ token, user: { id: user.id, username, email, avatar } });
  })
);

// @route   POST /api/user/login
// @desc    Authenticate user & get token
router.post(
  '/login',
  [
    check('email', 'Please include a valid email').isEmail(),
    check('password', 'Password is required').exists()
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res
        .status(400)
        .json({ errors: [{ msg: 'Invalid credentials' }] });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res
        .status(400)
        .json({ errors: [{ msg: 'Invalid credentials' }] });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });

    const payload: UserPayload = { user: { id: user.id } };

    const token = jwt.sign(payload, auth.jwtSecret as string, {
      expiresIn: 3600
    });
    res.json({ token });
  })
);

export default router;
