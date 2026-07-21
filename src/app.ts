import * as Sentry from '@sentry/node';
import { randomUUID } from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

import { getLogger } from './modules/logging';
import { http, sentry } from './modules/config';
import { prisma } from './lib/prisma';
import { FieldError } from './lib/errors';
import { appVersion } from './lib/version';
import { sentryBeforeSend } from './lib/sentry';
import { asyncHandler } from './modules/asyncHandler';

if (sentry.dsn) {
  Sentry.init({
    dsn: sentry.dsn,
    release: appVersion,
    environment: process.env.NODE_ENV ?? 'development',
    beforeSend: sentryBeforeSend
  });
}
import { isInstalled } from './modules/installState';
import { writeLimiter } from './middleware/rateLimiter';
import { startLinkHealthJob } from './modules/linkHealthJob';
import { startStatsJob } from './modules/statsJob';
import { startDonorExpiryJob } from './modules/donorExpiryJob';
import { startIrcJob } from './modules/ircJob';
import { startAnnounceJob } from './modules/announceJob';
import { startRankProgressionJob } from './modules/rankProgressionJob';
import { startAssetSweepJob } from './modules/assetSweepJob';

import installRouter from './routes/api/install';
import homeRouter from './routes/api/home';
import { specRouter, uiRouter } from './routes/api/docs';
import versionRouter from './routes/api/version';
import toolsRouter from './routes/api/tools';
import userRouter from './routes/api/user';
import authRouter from './routes/api/auth';
import profileRouter from './routes/api/profile';
import announcementsRouter from './routes/api/announcements';
import statsRouter from './routes/api/stats';
import stylesheetRouter from './routes/api/stylesheet';
import assetRouter from './routes/api/asset';
import commentsRouter from './routes/api/comments';
import subscriptionsRouter from './routes/api/subscriptions';
import notificationsRouter from './routes/api/notifications';
import postsRouter from './routes/api/posts';
import forumRouter from './routes/api/forum/forumRoute';
import forumCategoryRouter from './routes/api/forum/forumCategory';
import forumPollRouter from './routes/api/forum/forumPoll';
import requestsRouter from './routes/api/requests';
import downloadsRouter from './routes/api/downloads';
import ratioPolicyRouter from './routes/api/ratioPolicy';
import forumPollVoteRouter from './routes/api/forum/forumPollVote';
import forumLastReadRouter from './routes/api/forum/forumLastReadTopic';
import forumTopicNoteRouter from './routes/api/forum/forumTopicNote';
import communitiesRouter from './routes/api/communities/communities';
import contributionsRouter from './routes/api/communities/contributions';
import logCheckRouter from './routes/api/logCheck';
import artistRouter from './routes/api/communities/artist';
import collagesRouter from './routes/api/collages';
import messagesRouter from './routes/api/messages';
import staffInboxRouter from './routes/api/staffInbox';
import reportsRouter from './routes/api/reports';
import settingsRouter from './routes/api/settings';
import bookmarksRouter from './routes/api/bookmarks';
import siteHistoryRouter from './routes/api/siteHistory';
import wikiRouter from './routes/api/wiki';
import dncRouter from './routes/api/communities/dnc';
import searchRouter from './routes/api/search';
import randomRouter from './routes/api/random';
import top10Router from './routes/api/top10';
import ipBansRouter from './routes/api/ipBans';
import emailBlacklistRouter from './routes/api/emailBlacklist';
import donationsRouter from './routes/api/donations';
import staffRouter from './routes/api/staff';
import rulesRouter from './routes/api/rules';
import friendsRouter from './routes/api/friends';
import tagAliasesRouter from './routes/api/tagAliases';
import devToolsRouter from './routes/api/devTools';

const log = getLogger('app');

export const createApp = () => {
  const app = express();

  app.use(cors({ origin: http.corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('x-request-id', requestId);
    req.requestId = requestId;
    const start = Date.now();
    res.on('finish', () => {
      log.info('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
        requestId,
        userId: req.user?.id
      });
    });
    next();
  });

  app.get('/', (_req: Request, res: Response) => res.send('API Running'));

  app.get(
    '/health',
    asyncHandler(async (_req: Request, res: Response) => {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', db: 'ok', version: appVersion });
    })
  );

  app.use('/api/install', installRouter);
  app.use('/api/version', versionRouter);
  app.use('/api/docs/json', specRouter);
  app.use('/api/docs', uiRouter);

  app.use('/api', async (_req: Request, res: Response, next: NextFunction) => {
    if (await isInstalled()) return next();
    res.status(503).json({
      installed: false,
      msg: 'Application not installed. Please complete setup at /install.'
    });
  });

  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return writeLimiter(req, res, next);
    }
    next();
  });

  app.use('/api/tools', toolsRouter);
  app.use('/api/home', homeRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/announcements', announcementsRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/stylesheet', stylesheetRouter);
  app.use('/api/asset', assetRouter);
  app.use('/api/comments', commentsRouter);
  app.use('/api/subscriptions', subscriptionsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/posts', postsRouter);
  app.use('/api/forums/categories', forumCategoryRouter);
  app.use('/api/forums/polls', forumPollRouter);
  app.use('/api/forums/poll-votes', forumPollVoteRouter);
  app.use('/api/forums/last-read', forumLastReadRouter);
  app.use('/api/forums/topic-notes', forumTopicNoteRouter);
  app.use('/api/forums', forumRouter);
  app.use('/api/requests', requestsRouter);
  app.use('/api', downloadsRouter);
  app.use('/api/ratio-policy', ratioPolicyRouter);
  app.use('/api/communities', communitiesRouter);
  app.use('/api/contributions', contributionsRouter);
  app.use('/api/log-check', logCheckRouter);
  app.use('/api/artists', artistRouter);
  app.use('/api/collages', collagesRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/staff-inbox', staffInboxRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/bookmarks', bookmarksRouter);
  app.use('/api/site-history', siteHistoryRouter);
  app.use('/api/wiki', wikiRouter);
  app.use('/api/communities/:communityId/dnc', dncRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/random', randomRouter);
  app.use('/api/top10', top10Router);
  app.use('/api/ip-bans', ipBansRouter);
  app.use('/api/email-blacklist', emailBlacklistRouter);
  app.use('/api/donations', donationsRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/rules', rulesRouter);
  app.use('/api/friends', friendsRouter);
  app.use('/api/tag-aliases', tagAliasesRouter);

  // Dev tools — only mounted outside production
  if (process.env.NODE_ENV !== 'production') {
    app.use('/api/dev', devToolsRouter);
  }

  if (sentry.dsn) {
    Sentry.setupExpressErrorHandler(app);
  }

  app.use(
    (
      err: Error & { statusCode?: number },
      req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      const status = err.statusCode ?? 500;
      const logMeta = {
        message: err.message,
        stack: err.stack,
        route: req.path,
        method: req.method,
        userId: req.user?.id
      };
      if (status >= 500) {
        log.error('Unhandled error', logMeta);
      } else {
        log.warn('Request error', logMeta);
      }
      // Field-scoped errors render as validate()'s envelope, not { msg }, so a
      // form can attach each message to the input that caused it.
      if (err instanceof FieldError) {
        res.status(status).json({ errors: err.fieldErrors });
        return;
      }
      const message =
        process.env.NODE_ENV === 'production' && status === 500
          ? 'Internal server error'
          : err.message ?? 'Server Error';
      res.status(status).json({ msg: message });
    }
  );

  if (process.env.DISABLE_BACKGROUND_JOBS !== '1') {
    startLinkHealthJob();
    startStatsJob();
    startDonorExpiryJob();
    startIrcJob();
    startAnnounceJob();
    startRankProgressionJob();
    startAssetSweepJob();
  }

  return app;
};

export default createApp();
