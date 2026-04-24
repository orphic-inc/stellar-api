import type { Request } from 'express';

export type AuthUser = {
  id: number;
  userRankId: number;
  userRankLevel: number;
};

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}
