import 'express';

declare module 'express' {
  interface Request {
    user?: {
      id: number;
      userRankId: number;
      userRankLevel: number;
      secondaryRankIds?: number[];
      permittedForumIds?: number[];
      permissions?: Record<string, boolean>;
    };
  }
}
