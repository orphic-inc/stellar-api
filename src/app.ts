import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import { getLogger } from './modules/logging';
import { http } from './modules/config';
import { isInstalled } from './modules/installState';
import { startLinkHealthJob } from './modules/linkHealthJob';

import installRouter from './routes/api/install';
import homeRouter from './routes/api/home';
import { specRouter, uiRouter } from './routes/api/docs';
import toolsRouter from './routes/api/tools';
import userRouter from './routes/api/user';
import authRouter from './routes/api/auth';
import profileRouter from './routes/api/profile';
import announcementsRouter from './routes/api/announcements';
import statsRouter from './routes/api/stats';
import stylesheetRouter from './routes/api/stylesheet';
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
import artistRouter from './routes/api/communities/artist';

const log = getLogger('app');

export const createApp = () => {
  const app = express();

  app.use(cors({ origin: http.corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  app.get('/', (_req: Request, res: Response) => res.send('API Running'));

  app.use('/api/install', installRouter);
  app.use('/api/docs/json', specRouter);
  app.use('/api/docs', uiRouter);

  app.use('/api', async (_req: Request, res: Response, next: NextFunction) => {
    if (await isInstalled()) return next();
    res.status(503).json({
      installed: false,
      msg: 'Application not installed. Please complete setup at /install.'
    });
  });

  app.use('/api/tools', toolsRouter);
  app.use('/api/home', homeRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/announcements', announcementsRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/stylesheet', stylesheetRouter);
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
  app.use('/api/artists', artistRouter);

  app.use(
    (
      err: Error & { statusCode?: number },
      req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      log.error('Unhandled error', {
        message: err.message,
        stack: err.stack,
        route: req.path,
        method: req.method,
        userId: req.user?.id
      });
      const status = err.statusCode ?? 500;
      const message =
        process.env.NODE_ENV === 'production' && status === 500
          ? 'Internal server error'
          : err.message ?? 'Server Error';
      res.status(status).json({ msg: message });
    }
  );

  startLinkHealthJob();

  return app;
};

export default createApp();
