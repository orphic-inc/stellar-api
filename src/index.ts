import { http } from './modules/config';
import { getLogger } from './modules/logging';
import app from './app';

const log = getLogger('app');
app.listen(http.port, () => log.info(`Listening on port ${http.port}`));
