import express, { Request, Response } from 'express';

import { getLogger } from './modules/logging.ts';
import { http } from './modules/config.ts';

import * as dotenv from 'dotenv';
dotenv.config({ path: __dirname + '../.env' });

import userRoute from './routes/api/user.ts';

const isProduction = process.env.NODE_ENV === 'production';
const app = express();
const log = getLogger('app');

// define routes
app.get('/', (req: Request, res: Response) => res.send('API Running'));
app.use('/api/user', userRoute);

// handle any downstream errors
app.use((err: string, req: Request, res: Response) => {
  console.log(err, 'downstream errors - index.ts');
  res.status(500).send('Server Error');
});

app.listen(http.port, () => log.info(`Listening on port ${http.port}`));
