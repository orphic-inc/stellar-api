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

const fetchPermissions = async (userId: number): Promise<Record<string, boolean>> => {
  const rank = await prisma.userRank.findFirst({
    where: { users: { some: { id: userId } } },
    select: { permissions: true }
  });
  return (rank?.permissions ?? {}) as Record<string, boolean>;
};

// Returns [requireAuth, permissionCheck] — spread into route definitions:
//   router.post('/', ...requirePermission('admin'), asyncHandler(...))
export const requirePermission = (...permissions: Permission[]): RequestHandler[] => [
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const perms = await fetchPermissions(req.user!.id);
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
      const perms = await fetchPermissions(req.user!.id);
      if (hasPermission(perms, permission)) return next();
      res.status(403).json({ msg: 'Permission denied' });
    } catch (err) {
      next(err);
    }
  }
];
