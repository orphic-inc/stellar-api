import { Request, Response, NextFunction, RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from './auth';

export const VALID_PERMISSIONS = [
  'forums_read',
  'forums_post',
  'forums_moderate',
  'forums_manage',
  'communities_manage',
  'news_manage',
  'invites_manage',
  'users_edit',
  'users_warn',
  'users_disable',
  'staff',
  'admin'
] as const;

export type Permission = (typeof VALID_PERMISSIONS)[number];

const hasPermission = (
  perms: Record<string, boolean>,
  permission: Permission
): boolean => {
  // staff permission also satisfies admin gates
  if (permission === 'admin') return !!(perms['admin'] || perms['staff']);
  return !!perms[permission];
};

export const loadPermissions = async (
  req: Request,
  res: Response
): Promise<Record<string, boolean>> => {
  if (res.locals.userPerms) return res.locals.userPerms;
  const rank = await prisma.userRank.findUnique({
    where: { id: req.user!.userRankId },
    select: { permissions: true }
  });
  res.locals.userPerms = (rank?.permissions ?? {}) as Record<string, boolean>;
  return res.locals.userPerms;
};

export const isModerator = async (req: Request, res: Response): Promise<boolean> => {
  const perms = await loadPermissions(req, res);
  return !!(perms['forums_moderate'] || perms['admin'] || perms['staff']);
};

// Returns [requireAuth, permissionCheck] — spread into route definitions:
//   router.post('/', ...requirePermission('admin'), asyncHandler(...))
export const requirePermission = (...permissions: Permission[]): RequestHandler[] => [
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const perms = await loadPermissions(req, res);
      const granted = permissions.some((p) => hasPermission(perms, p));
      if (granted) return next();
      res.status(403).json({ msg: 'Permission denied' });
    } catch (err) {
      next(err);
    }
  }
];

// Passes if req.user owns the resource OR has the given permission.
// getOwnerId receives req and should return the resource owner's userId synchronously.
export const requireOwnerOrPermission = (
  getOwnerId: (req: Request) => number | null | undefined,
  permission: Permission
): RequestHandler[] => [
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ownerId = getOwnerId(req);
      if (ownerId != null && ownerId === req.user!.id) return next();
      const perms = await loadPermissions(req, res);
      if (hasPermission(perms, permission)) return next();
      res.status(403).json({ msg: 'Permission denied' });
    } catch (err) {
      next(err);
    }
  }
];
