import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from './auth';

export const requirePermission = (permission?: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    requireAuth(req, res, async () => {
      if (!permission) return next();
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        include: { userRank: true }
      });
      if (!user) return res.status(401).json({ msg: 'Unauthorized' });
      const perms = user.userRank.permissions as Record<string, boolean>;
      if (perms[permission]) return next();
      res.status(403).json({ msg: 'Permission denied' });
    });
  };
};
