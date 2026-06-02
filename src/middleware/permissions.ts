import { Request, Response, NextFunction, RequestHandler } from 'express';
import { requireAuth } from './auth';
import type { AuthenticatedRequest } from '../types/auth';
import {
  type Permission,
  hasPermission,
  normalizePermissions,
  VALID_PERMISSIONS
} from '../lib/rankPermissions';
import { getUserRankAccess } from '../lib/userRankAccess';
import { getLogger } from '../modules/logging';

const secLog = getLogger('security');

export { VALID_PERMISSIONS, hasPermission };
export type { Permission };

export const loadPermissions = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Record<string, boolean>> => {
  if (res.locals.userPerms) return res.locals.userPerms;
  if (req.user.permissions) {
    res.locals.userPerms = req.user.permissions;
    return res.locals.userPerms;
  }

  const access = await getUserRankAccess(req.user.id);
  res.locals.userPerms = (access?.permissions ??
    normalizePermissions(null)) as Record<string, boolean>;
  return res.locals.userPerms;
};

// Like requirePermission('admin') but does NOT let staff satisfy the gate.
// Use for routes that must be restricted to full admins only.
export const requireAdminOnly = (): RequestHandler[] => [
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const perms = await loadPermissions(req as AuthenticatedRequest, res);
      if (perms['admin']) return next();
      secLog.warn('Permission denied', {
        userId: (req as AuthenticatedRequest).user?.id,
        required: 'admin',
        method: req.method,
        path: req.path
      });
      res.status(403).json({ msg: 'Permission denied' });
    } catch (err) {
      next(err);
    }
  }
];

// Returns [requireAuth, permissionCheck] — spread into route definitions:
//   router.post('/', ...requirePermission('admin'), asyncHandler(...))
export const requirePermission = (
  ...permissions: Permission[]
): RequestHandler[] => [
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const perms = await loadPermissions(req as AuthenticatedRequest, res);
      const granted = permissions.some((p) => hasPermission(perms, p));
      if (granted) return next();
      secLog.warn('Permission denied', {
        userId: (req as AuthenticatedRequest).user?.id,
        required: permissions,
        method: req.method,
        path: req.path
      });
      res.status(403).json({ msg: 'Permission denied' });
    } catch (err) {
      next(err);
    }
  }
];

// Returns [requireAuth, permissionCheck] — admits only users with the literal 'admin' permission.
// Staff alone does not pass (unlike requirePermission('admin') which treats staff ≡ admin).
export const requireStrictAdmin = (): RequestHandler[] => [
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const perms = await loadPermissions(req as AuthenticatedRequest, res);
      if (perms['admin']) return next();
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
      const authReq = req as AuthenticatedRequest;
      const ownerId = getOwnerId(req);
      if (ownerId != null && ownerId === authReq.user.id) return next();
      const perms = await loadPermissions(authReq, res);
      if (hasPermission(perms, permission)) return next();
      res.status(403).json({ msg: 'Permission denied' });
    } catch (err) {
      next(err);
    }
  }
];
