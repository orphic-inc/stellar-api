import { Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/node';
import jwt from 'jsonwebtoken';
import { auth as authConfig } from '../modules/config';
import { prisma } from '../lib/prisma';
import { computeUserRankAccess } from '../lib/userRankAccess';
import { userContextFromRequest } from '../lib/sentry';

interface JwtPayload {
  user: { id: number; sessionId?: string };
}

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ msg: 'No token, authorization denied' });
    return;
  }
  try {
    const decoded = jwt.verify(token, authConfig.jwtSecret) as JwtPayload;
    const user = await prisma.user.findUnique({
      where: { id: decoded.user.id },
      select: {
        id: true,
        userRankId: true,
        disabled: true,
        userRank: {
          select: {
            id: true,
            level: true,
            permissions: true,
            permittedForumIds: true
          }
        },
        secondaryRanks: {
          select: {
            userRankId: true,
            userRank: {
              select: {
                id: true,
                level: true,
                permissions: true,
                permittedForumIds: true
              }
            }
          }
        }
      }
    });
    if (!user || user.disabled) {
      res.status(401).json({ msg: 'Account is not authorized' });
      return;
    }

    const sessionId = decoded.user.sessionId;
    if (sessionId) {
      const session = await prisma.userSession.findFirst({
        where: { id: sessionId, revokedAt: null }
      });
      if (!session) {
        res.status(401).json({ msg: 'Session has been revoked' });
        return;
      }
      prisma.userSession
        .update({
          where: { id: sessionId },
          data: { lastActiveAt: new Date() }
        })
        .catch(() => undefined);
    }

    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0]
        ?.trim() ?? req.ip;
    if (ip) {
      prisma.user
        .update({ where: { id: user.id }, data: { lastIp: ip } })
        .catch(() => undefined);
    }

    const rankAccess = computeUserRankAccess(user);

    req.user = {
      id: user.id,
      userRankId: user.userRankId,
      userRankLevel: rankAccess.effectiveLevel,
      secondaryRankIds: rankAccess.secondaryRankIds,
      permittedForumIds: rankAccess.permittedForumIds,
      permissions: rankAccess.permissions as Record<string, boolean>
    };
    // Attach who-hit-this to the request's Sentry scope for error context.
    Sentry.setUser(userContextFromRequest(req));
    next();
  } catch {
    res.status(401).json({ msg: 'Token is not valid' });
  }
};
