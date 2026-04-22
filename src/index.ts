import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import * as dotenv from 'dotenv';
dotenv.config();

import { getLogger } from './modules/logging';
import { http } from './modules/config';
import { isInstalled } from './modules/installState';

import installRouter from './routes/api/install';
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
import forumRouter from './routes/api/sections/forum/forumRoute';
import forumCategoryRouter from './routes/api/sections/forum/forumCategory';
import forumPollRouter from './routes/api/sections/forum/forumPoll';
import forumPollVoteRouter from './routes/api/sections/forum/forumPollVote';
import forumLastReadRouter from './routes/api/sections/forum/forumLastReadTopic';
import forumTopicNoteRouter from './routes/api/sections/forum/forumTopicNote';
import communitiesRouter from './routes/api/sections/communities/communitiesRoute';
import contributionsRouter from './routes/api/sections/communities/contributions';
import artistRouter from './routes/api/sections/communities/artist';

const log = getLogger('app');
const app = express();

app.use(cors({ origin: http.corsOrigin, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.get('/', (_req: Request, res: Response) => res.send('API Running'));

// Install route is always public — must be mounted before the install guard
app.use('/api/install', installRouter);

// Block all other API routes until installation is complete
app.use('/api', async (_req: Request, res: Response, next: NextFunction) => {
  if (await isInstalled()) return next();
  res.status(503).json({ installed: false, msg: 'Application not installed. Please complete setup at /install.' });
});

app.use('/api/tools', toolsRouter);
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
app.use('/api/communities', communitiesRouter);
app.use('/api/contributions', contributionsRouter);
app.use('/api/artists', artistRouter);

app.use((err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  log.error(err.message);
  res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Server Error' });
});

app.listen(http.port, () => log.info(`Listening on port ${http.port}`));
