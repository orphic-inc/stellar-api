/**
 * The Member Feed (ADR-0014, #262) — the one member surface outside the session.
 *
 * A feed reader cannot send a cookie, so each route authenticates the feed's
 * OWNER from `?user=&token=` and every read below is the owner's, never a
 * request's. There is no `req.user` here, and nothing may reach for one.
 *
 * The chain order is the design, not incidental:
 *
 *   feedAuthLimiter → token check → feedLimiter → filter validation → read
 *
 *  - `feedAuthLimiter` counts only this router's 404, per IP.
 *  - The token check answers ONE 404 for every failure, so a feed URL cannot
 *    confirm an id. It runs before validation, so an unauthenticated caller
 *    never sees a 400.
 *  - `feedLimiter` is keyed on the authenticated owner, so it can only run
 *    after the check.
 */
import express, { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../../modules/asyncHandler';
import { authenticateFeedOwner } from '../../modules/feedToken';
import {
  renderBookmarksFeed,
  renderContributionsFeed,
  renderMineFeed,
  renderNewsFeed
} from '../../modules/feeds';
import { feedAuthLimiter, feedLimiter } from '../../middleware/rateLimiter';
import { parsedQuery, validateQuery } from '../../middleware/validate';
import {
  contributionFeedQuerySchema,
  feedCredentialsSchema,
  type ContributionFeedQuery
} from '../../schemas/feeds';

const router = express.Router();

export const FEED_NOT_FOUND = 'Feed not found';

const requireFeedOwner = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const credentials = feedCredentialsSchema.safeParse(req.query);
    const owner = credentials.success
      ? await authenticateFeedOwner(
          credentials.data.user,
          credentials.data.token
        )
      : null;
    if (!owner) {
      res.status(404).json({ msg: FEED_NOT_FOUND });
      return;
    }
    res.locals.feedOwner = owner;
    next();
  }
);

const ownerOf = (res: Response): number =>
  (res.locals.feedOwner as { id: number }).id;

/** `private`: the body is one member's view. Five minutes: readers poll. */
const sendFeed = (res: Response, xml: string) => {
  res.set('Cache-Control', 'private, max-age=300');
  res.type('application/rss+xml; charset=utf-8').send(xml);
};

const feedChain = [feedAuthLimiter, requireFeedOwner, feedLimiter];

router.get(
  '/contributions.xml',
  ...feedChain,
  validateQuery(contributionFeedQuerySchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const { community, tag, format, bitrate } =
      parsedQuery<ContributionFeedQuery>(res);
    sendFeed(
      res,
      await renderContributionsFeed(ownerOf(res), {
        community,
        tag,
        format,
        bitrate
      })
    );
  })
);

router.get(
  '/mine.xml',
  ...feedChain,
  asyncHandler(async (_req: Request, res: Response) => {
    sendFeed(res, await renderMineFeed(ownerOf(res)));
  })
);

router.get(
  '/news.xml',
  ...feedChain,
  asyncHandler(async (_req: Request, res: Response) => {
    sendFeed(res, await renderNewsFeed(ownerOf(res)));
  })
);

router.get(
  '/bookmarks.xml',
  ...feedChain,
  asyncHandler(async (_req: Request, res: Response) => {
    sendFeed(res, await renderBookmarksFeed(ownerOf(res)));
  })
);

export default router;
