import { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AuthenticatedRequest } from '../types/auth';

export const asyncHandler =
  (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
  ): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const authHandler =
  (
    fn: (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) => Promise<unknown>
  ): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req as AuthenticatedRequest, res, next)).catch(next);
  };
