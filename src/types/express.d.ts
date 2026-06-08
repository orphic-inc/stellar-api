import 'express';

declare module 'express' {
  interface Request {
    /** Correlation id set by the request-logging middleware (also echoed as the x-request-id header). */
    requestId?: string;
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
