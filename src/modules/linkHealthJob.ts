import { getLogger } from './logging';
import { recheckStaleLinks, sweepStaleWarnLinks } from './linkHealth';

const log = getLogger('linkHealthJob');

const INTERVAL_MS = 24 * 60 * 60 * 1000; // every 24 hours
const STARTUP_DELAY_MS = 60_000; // wait 60s after boot before first run

const runCycle = async (): Promise<void> => {
  // Recheck stale links first (may resolve WARNs), then sweep the persistent
  // ones to FAIL.
  await recheckStaleLinks().catch((err) =>
    log.error('Stale link recheck failed', { err })
  );
  await sweepStaleWarnLinks().catch((err) =>
    log.error('Stale WARN sweep failed', { err })
  );
};

export const startLinkHealthJob = (): void => {
  const outer = setTimeout(() => {
    void runCycle();
    setInterval(() => void runCycle(), INTERVAL_MS).unref();
  }, STARTUP_DELAY_MS);
  outer.unref();

  log.info('Link health job scheduled', {
    startupDelayMs: STARTUP_DELAY_MS,
    intervalMs: INTERVAL_MS
  });
};
