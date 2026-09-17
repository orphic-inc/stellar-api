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
  return scrubFeedToken(event);
};

// A Member Feed URL carries a bearer credential in its query string (ADR-0014
// §2). The api's request log records only `req.path`, but Sentry captures the
// full URL and query, so an error on a feed read would ship a live token to a
// third party. Redacted here, the one place every event passes through.
const FEED_TOKEN_PARAM = /([?&]token=)[^&#]*/g;
const REDACTED = '[redacted]';

type QueryParams = NonNullable<
  NonNullable<ErrorEvent['request']>['query_string']
>;

const scrubQuery = (query: QueryParams): QueryParams => {
  if (typeof query === 'string') {
    return `?${query}`.replace(FEED_TOKEN_PARAM, `$1${REDACTED}`).slice(1);
  }
  if (Array.isArray(query)) {
    return query.map(([key, value]): [string, string] =>
      key === 'token' ? [key, REDACTED] : [key, value]
    );
  }
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) =>
      key === 'token' ? [key, REDACTED] : [key, value]
    )
  );
};

export const scrubFeedToken = (event: ErrorEvent): ErrorEvent => {
  const { request } = event;
  if (!request) return event;
  if (request.url) {
    request.url = request.url.replace(FEED_TOKEN_PARAM, `$1${REDACTED}`);
  }
  if (request.query_string !== undefined) {
    request.query_string = scrubQuery(request.query_string);
  }
  return event;
};
