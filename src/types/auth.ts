import type { Request } from 'express';

export type AuthUser = {
  id: number;
  userRankId: number;
  userRankLevel: number;
  secondaryRankIds?: number[];
  permittedForumIds?: number[];
  permissions?: Record<string, boolean>;
};

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}
