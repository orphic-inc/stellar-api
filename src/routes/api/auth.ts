import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { check, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { auth as authConfig } from '../../modules/config';
import { requireAuth } from '../../middleware/auth';

const router = express.Router();

// GET /api/auth/status
router.get('/status', (req: Request, res: Response) => {
  const token = req.cookies?.token;
  if (!token) return res.status(403).json({ isAuthenticated: false });
  try {
    const decoded = jwt.verify(token, authConfig.jwtSecret) as { user: { id: number } };
    res.json({ isAuthenticated: true, user: { id: decoded.user.id } });
  } catch {
    res.status(403).json({ isAuthenticated: false });
  }
});

// GET /api/auth/logout
router.get('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ msg: 'User logged out' });
});

// GET /api/auth — get current user
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true, username: true, email: true, avatar: true,
        isArtist: true, isDonor: true, canDownload: true,
        inviteCount: true, dateRegistered: true, lastLogin: true,
        userRank: { select: { name: true, color: true, badge: true, permissions: true } },
        profile: true,
        userSettings: true
      }
    });
    if (!user) return res.status(401).json({ msg: 'Unauthorized' });
    res.json(user);
  })
);

// POST /api/auth — login
router.post(
  '/',
  [
    check('email', 'Please include a valid email').isEmail(),
    check('password', 'Password is required').exists()
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body as { email: string; password: string };

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.status(400).json({ errors: [{ msg: 'Invalid credentials' }] });

    if (user.disabled) return res.status(403).json({ errors: [{ msg: 'Account disabled' }] });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ errors: [{ msg: 'Invalid credentials' }] });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });

    const payload = { user: { id: user.id } };
    jwt.sign(payload, authConfig.jwtSecret, { expiresIn: 360000 }, (err, token) => {
      if (err) throw err;
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production'
      });
      res.json({ token });
    });
  })
);

export default router;
