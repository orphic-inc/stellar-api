import { getLogger } from './logging';
import { recheckStaleLinks } from './linkHealth';

const log = getLogger('linkHealthJob');

const INTERVAL_MS = 24 * 60 * 60 * 1000; // every 24 hours
const STARTUP_DELAY_MS = 60_000; // wait 60s after boot before first run

export const startLinkHealthJob = (): void => {
  const outer = setTimeout(() => {
    recheckStaleLinks().catch((err) =>
      log.error('Stale link recheck failed', { err })
    );
    setInterval(() => {
      recheckStaleLinks().catch((err) =>
        log.error('Stale link recheck failed', { err })
      );
    }, INTERVAL_MS).unref();
  }, STARTUP_DELAY_MS);
  outer.unref();

  log.info('Link health job scheduled', {
    startupDelayMs: STARTUP_DELAY_MS,
    intervalMs: INTERVAL_MS
  });
};
