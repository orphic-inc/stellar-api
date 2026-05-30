import { http } from './modules/config';
import { getLogger } from './modules/logging';
import { prisma } from './lib/prisma';
import app from './app';

const log = getLogger('app');

const server = app.listen(http.port, () =>
  log.info(`Listening on port ${http.port}`)
);

const shutdown = (signal: string) => {
  log.info(`${signal} received — shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    log.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
