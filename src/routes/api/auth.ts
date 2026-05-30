import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { auth as authConfig, email as emailConfig } from '../../modules/config';
import { requireAuth } from '../../middleware/auth';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import { authLimiter } from '../../middleware/rateLimiter';
import {
  loginSchema,
  registerSchema,
  changePasswordSchema,
  changeEmailSchema,
  recoveryRequestSchema,
  recoveryResetSchema,
  type LoginInput,
  type RegisterInput,
  type ChangePasswordInput,
  type ChangeEmailInput,
  type RecoveryRequestInput,
  type RecoveryResetInput
} from '../../schemas/auth';
import {
  authUserSelect,
  registerUser,
  loginUser,
  toAuthUser,
  changePassword,
  changeEmail,
  generateRecoveryToken,
  persistRecoveryToken,
  resetPasswordWithToken
} from '../../modules/auth';
import { getSettings } from '../../modules/settings';
import { sendRecoveryEmail } from '../../lib/mailer';
import { getLogger } from '../../modules/logging';
import { z } from 'zod';

const secLog = getLogger('security');

const router = express.Router();

const TOKEN_TTL_SECONDS = 3600; // 1 hour
const TOKEN_TTL_MS = TOKEN_TTL_SECONDS * 1000;

const issueToken = (userId: number, sessionId?: string): Promise<string> =>
  new Promise((resolve, reject) => {
    jwt.sign(
      { user: { id: userId, ...(sessionId ? { sessionId } : {}) } },
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

const sessionIdParamsSchema = z.object({
  id: z.string().min(1)
});

// POST /api/auth/logout
router.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    const token = req.cookies?.token;
    if (token) {
      try {
        const decoded = jwt.verify(token, authConfig.jwtSecret) as {
          user: { id: number; sessionId?: string };
        };
        if (decoded.user.sessionId) {
          await prisma.userSession.updateMany({
            where: { id: decoded.user.sessionId, revokedAt: null },
            data: { revokedAt: new Date() }
          });
        }
      } catch {
        // ignore invalid token on logout
      }
    }
    res.clearCookie('token', { sameSite: 'lax', httpOnly: true });
    res.status(204).send();
  })
);

// POST /api/auth/register — public self-registration
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { username, email, password, inviteKey } =
      parsedBody<RegisterInput>(res);

    const settings = await getSettings();

    const result = await registerUser({
      username,
      email,
      password,
      registrationMode: settings.registrationStatus,
      inviteKey
    });
    if (!result.ok) {
      switch (result.reason) {
        case 'registration_closed':
          return res
            .status(403)
            .json({ msg: 'Registration is currently closed' });
        case 'invite_required':
          return res
            .status(403)
            .json({ msg: 'An invite key is required to register' });
        case 'invalid_invite':
          return res
            .status(403)
            .json({ msg: 'Invalid or already-used invite key' });
        case 'invite_email_mismatch':
          return res
            .status(403)
            .json({ msg: 'Invite key is not valid for this email address' });
        case 'bad_password':
          return res.status(400).json({ msg: 'Password is not allowed' });
        default:
          return res.status(400).json({ msg: 'User already exists' });
      }
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
    res.json(toAuthUser(user));
  })
);

// POST /api/auth/password — change password
router.post(
  '/password',
  requireAuth,
  validate(changePasswordSchema),
  authHandler(async (req, res) => {
    const { currentPassword, newPassword } =
      parsedBody<ChangePasswordInput>(res);
    await changePassword(req.user.id, currentPassword, newPassword);
    res.status(204).send();
  })
);

// PUT /api/auth/email — change email
router.put(
  '/email',
  requireAuth,
  validate(changeEmailSchema),
  authHandler(async (req, res) => {
    const { newEmail, password } = parsedBody<ChangeEmailInput>(res);
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0]
        ?.trim() ??
      req.ip ??
      '';
    await changeEmail(req.user.id, newEmail, password, ip);
    res.json({ msg: 'Email updated' });
  })
);

// POST /api/auth/recovery/request — request account recovery
router.post(
  '/recovery/request',
  authLimiter,
  validate(recoveryRequestSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email } = parsedBody<RecoveryRequestInput>(res);
    const genericMsg = 'If that email exists, a recovery link has been sent';

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true }
    });

    if (user) {
      const token = generateRecoveryToken();
      const resetUrl = `${emailConfig.siteUrl}/recovery?token=${token}`;
      // Only write to DB if email delivery succeeds — avoids dead rows when SMTP is off
      const sent = await sendRecoveryEmail(user.email, resetUrl);
      if (sent) {
        await persistRecoveryToken(user.id, token);
      }
    }

    res.json({ msg: genericMsg });
  })
);

// POST /api/auth/recovery/reset — reset password with recovery token
router.post(
  '/recovery/reset',
  authLimiter,
  validate(recoveryResetSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { token, newPassword } = parsedBody<RecoveryResetInput>(res);
    await resetPasswordWithToken(token, newPassword);
    res.json({ msg: 'Password reset successfully' });
  })
);

// GET /api/auth/sessions — list active sessions
router.get(
  '/sessions',
  requireAuth,
  authHandler(async (req, res) => {
    const sessions = await prisma.userSession.findMany({
      where: { userId: req.user.id, revokedAt: null },
      orderBy: { lastActiveAt: 'desc' }
    });
    res.json(sessions);
  })
);

// DELETE /api/auth/sessions/:id — revoke a session
router.delete(
  '/sessions/:id',
  requireAuth,
  validateParams(sessionIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: string }>(res);

    const session = await prisma.userSession.findFirst({
      where: { id, userId: req.user.id }
    });
    if (!session) return res.status(404).json({ msg: 'Session not found' });

    await prisma.userSession.update({
      where: { id },
      data: { revokedAt: new Date() }
    });
    res.status(204).send();
  })
);

// POST /api/auth — login
router.post(
  '/',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = parsedBody<LoginInput>(res);

    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0]
        ?.trim() ??
      req.ip ??
      '';

    const result = await loginUser(email, password, ip);
    if (!result.ok) {
      const redacted = email.replace(/^(.{3})(.*)(@.*)$/, '$1***$3');
      secLog.warn('Failed login attempt', {
        reason: result.reason,
        ip,
        email: redacted
      });
      if (result.reason === 'disabled')
        return res.status(403).json({ msg: 'Account disabled' });
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    const session = await prisma.userSession.create({
      data: {
        userId: result.user.id,
        ipAddress: ip,
        userAgent: req.headers['user-agent'] ?? ''
      }
    });

    const token = await issueToken(result.user.id, session.id);
    res.cookie('token', token, cookieOptions);
    res.json({ user: result.user });
  })
);

export default router;
