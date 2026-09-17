import { Request, Response, NextFunction } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { getLogger } from '../modules/logging';
import { markGate } from '../lib/routeGate';

const secLog = getLogger('security');

const createLimiter = (
  windowMs: number,
  max: number,
  msg: string,
  options: Partial<Options> = {}
) =>
  rateLimit({
    ...options,
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { msg },
    handler: (req: Request, res: Response, _next: NextFunction, options) => {
      secLog.warn('Rate limit exceeded', {
        ip: req.ip,
        method: req.method,
        path: req.path,
        limit: options.max,
        windowMs: options.windowMs
      });
      res.status(options.statusCode).json(options.message);
    }
  });

export const authLimiter = createLimiter(
  15 * 60 * 1000,
  20,
  'Too many requests, please try again later'
);

export const installLimiter = createLimiter(
  60 * 60 * 1000,
  5,
  'Too many install attempts, please try again later'
);

export const writeLimiter = createLimiter(
  60 * 1000,
  30,
  'Too many requests, please slow down'
);

export const downloadLimiter = createLimiter(
  60 * 1000,
  10,
  'Too many download requests, please slow down'
);

/**
 * Member Feed failures, per IP (ADR-0014 §5, #262). Counts ONLY the feed's
 * 404 — a bad token, unknown id or disabled member — so brute force and junk
 * floods are bounded while a reader polling successfully is never counted. A
 * member's own 429 from `feedLimiter` is not a failure here either: an
 * aggregator polling many members from one IP must not have one member's
 * over-polling spend everyone's budget.
 */
export const feedAuthLimiter = createLimiter(
  15 * 60 * 1000,
  30,
  'Too many failed feed requests, please try again later',
  {
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 404
  }
);

/**
 * Member Feed reads, per validated MEMBER across all their feeds (ADR-0014 §5).
 * Mounted after the token check, which sets `res.locals.feedOwner`, so the key
 * is an authenticated id: an attacker cannot spend someone else's budget, and
 * members behind one aggregator IP each keep their own.
 */
export const feedLimiter = createLimiter(
  60 * 60 * 1000,
  120,
  'Too many feed requests, please slow down',
  {
    keyGenerator: (_req, res) =>
      `feed-member:${(res.locals.feedOwner as { id: number }).id}`
  }
);

// Labelled so the contract can derive the 429 these answer, rather than have it
// hand-written per route (#553). Same mechanism as the auth gates: `markGate`
// stamps, `readGate` reads it back off the built app. Stamped in place rather
// than by wrapping the declarations, for the reason auth.ts records — renaming
// a declaration makes Codacy's Lizard report its pre-existing complexity as new.
markGate(authLimiter, 'rateLimit');
markGate(installLimiter, 'rateLimit');
markGate(writeLimiter, 'rateLimit');
markGate(downloadLimiter, 'rateLimit');
markGate(feedAuthLimiter, 'rateLimit');
markGate(feedLimiter, 'rateLimit');

/**
 * The methods the site-wide write limiter guards.
 *
 * Exported because it is read twice and must not be written twice: once by
 * `mutationRateLimit` below to decide whether to run, and once by its gate stamp
 * to tell the contract which operations can answer a 429. Two copies of this
 * list is the encoded-twice shape that let 309 of 364 `security` blocks drift.
 */
export const RATE_LIMITED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * The site-wide write limiter, mounted once at `/api` (see `app.ts`).
 *
 * Lives here rather than as an inline arrow at the mount site so that the
 * branch, the limiter it guards and the gate stamp describing it are one thing
 * in one place. As an anonymous wrapper it was invisible to `readGate`, which
 * reads the mounted function: the limiter underneath could be stamped all day
 * and the contract would never see it (#553).
 *
 * A read is never rate limited by this — 156 of the 364 contract operations —
 * so the stamp carries the method list rather than claiming every route can
 * answer a 429.
 */
export const mutationRateLimit = markGate(
  (req: Request, res: Response, next: NextFunction) => {
    if ((RATE_LIMITED_METHODS as readonly string[]).includes(req.method)) {
      return writeLimiter(req, res, next);
    }
    next();
  },
  'rateLimit',
  undefined,
  RATE_LIMITED_METHODS
);
