import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { auth as authConfig } from '../modules/config';
import { prisma } from '../lib/prisma';

interface JwtPayload {
  user: { id: number };
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
      select: { id: true, userRankId: true, disabled: true }
    });
    if (!user || user.disabled) {
      res.status(401).json({ msg: 'Account is not authorized' });
      return;
    }
    req.user = { id: user.id, userRankId: user.userRankId };
    next();
  } catch {
    res.status(401).json({ msg: 'Token is not valid' });
  }
};
