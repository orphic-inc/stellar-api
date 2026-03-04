import express, { Request, Response, NextFunction } from 'express';

import { getLogger } from './modules/logging.js';
import { http } from './modules/config.js';

import userRoute from './routes/api/user.js';
import artistRoute from './routes/api/artist.js';
import communityRoute from './routes/api/community.js';
import releaseRoute from './routes/api/release.js';
import productRoute from './routes/api/product.js';

const app = express();
const log = getLogger('app');

app.use(express.json());

// define routes
app.get('/', (_req: Request, res: Response) => res.send('API Running'));
app.use('/api/user', userRoute);
app.use('/api/artist', artistRoute);
app.use('/api/community', communityRoute);
app.use('/api/release', releaseRoute);
app.use('/api/product', productRoute);

// handle any downstream errors
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.message, 'downstream errors - index.ts');
  res.status(500).send('Server Error');
});

app.listen(http.port, () => log.info(`Listening on port ${http.port}`));

export default app;
