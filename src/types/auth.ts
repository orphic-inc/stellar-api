import type { Request } from 'express';

export type AuthUser = {
  id: number;
  userRankId: number;
  userRankLevel: number;
  // The session this request authenticated with, when the token carries one.
  // Optional because tokens issued before sessions existed have no sessionId,
  // which the auth middleware already tolerates.
  sessionId?: string;
  secondaryRankIds?: number[];
  permittedForumIds?: number[];
  permissions?: Record<string, boolean>;
};

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}
