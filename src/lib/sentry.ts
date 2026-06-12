import type { ErrorEvent, EventHint, User } from '@sentry/node';
import { AppError } from './errors';

type AuthedRequest = {
  user?: { id: number; userRankId: number; userRankLevel: number };
};

/**
 * Build the Sentry user context for a request — answers "who hit this error".
 * Returns null for unauthenticated requests (Sentry treats null as "clear").
 */
export const userContextFromRequest = (req: AuthedRequest): User | null => {
  if (!req.user) return null;
  return {
    id: String(req.user.id),
    userRankId: req.user.userRankId,
    userRankLevel: req.user.userRankLevel
  };
};

/**
 * Sentry beforeSend hook: drops operational errors so the dashboard reflects
 * real faults, not expected 4xx control flow. Operational = AppError with a
 * client-error status (< 500); everything else (5xx AppErrors, unexpected
 * exceptions) passes through.
 */
export const sentryBeforeSend = (
  event: ErrorEvent,
  hint: EventHint
): ErrorEvent | null => {
  const err = hint.originalException;
  if (err instanceof AppError && err.statusCode < 500) return null;
  return event;
};
