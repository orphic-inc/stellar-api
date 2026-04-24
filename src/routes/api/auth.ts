import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { auth as authConfig } from '../../modules/config';
import { requireAuth } from '../../middleware/auth';
import { validate, parsedBody } from '../../middleware/validate';
import { authLimiter } from '../../middleware/rateLimiter';
import {
  loginSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput
} from '../../schemas/auth';
import { authUserSelect, registerUser, loginUser } from '../../modules/auth';

const router = express.Router();

const TOKEN_TTL_SECONDS = 3600; // 1 hour
const TOKEN_TTL_MS = TOKEN_TTL_SECONDS * 1000;

const issueToken = (userId: number): Promise<string> =>
  new Promise((resolve, reject) => {
    jwt.sign(
      { user: { id: userId } },
      authConfig.jwtSecret,
      { expiresIn: TOKEN_TTL_SECONDS },
      (err, token) => {
        if (err || !token)
          return reject(err ?? new Error('Token generation failed'));
        resolve(token);
      }
    );
  });

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: TOKEN_TTL_MS
};

// POST /api/auth/logout
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token', { sameSite: 'lax', httpOnly: true });
  res.status(204).send();
});

// POST /api/auth/register — public self-registration
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { username, email, password } = parsedBody<RegisterInput>(res);

    const result = await registerUser(username, email, password);
    if (!result.ok) {
      return res.status(400).json({ msg: 'User already exists' });
    }

    const token = await issueToken(result.user.id);
    res.cookie('token', token, cookieOptions);
    res.status(201).json({ user: result.user });
  })
);

// GET /api/auth — get current user profile
router.get(
  '/',
  requireAuth,
  authHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: authUserSelect
    });
    if (!user) return res.status(401).json({ msg: 'Unauthorized' });
    res.json(user);
  })
);

// POST /api/auth — login
router.post(
  '/',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = parsedBody<LoginInput>(res);

    const result = await loginUser(email, password);
    if (!result.ok) {
      if (result.reason === 'disabled')
        return res.status(403).json({ msg: 'Account disabled' });
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    const token = await issueToken(result.user.id);
    res.cookie('token', token, cookieOptions);
    res.json({ user: result.user });
  })
);

export default router;
