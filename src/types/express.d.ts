import 'express';
import type { AuthUser } from './auth';

declare module 'express' {
  interface Request {
    /** Correlation id set by the request-logging middleware (also echoed as the x-request-id header). */
    requestId?: string;
    /**
     * Set by the auth middleware after the DB lookup. This references AuthUser
     * rather than restating its fields: the two used to be independent copies
     * of the same shape, and adding `sessionId` to one of them was caught only
     * because the other rejected it.
     */
    user?: AuthUser;
  }
}
