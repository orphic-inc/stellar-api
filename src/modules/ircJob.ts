import { getLogger } from './logging';
import { pollKorinMetrics } from './irc';
import { korin as korinConfig } from './config';

const log = getLogger('ircJob');

const STARTUP_DELAY_MS = 30_000; // wait 30s after boot before first poll

export const startIrcJob = (): void => {
  if (!korinConfig.apiUrl || !korinConfig.pullKey) {
    log.warn(
      'KORIN_API_URL or KORIN_PULL_KEY not configured — IRC metrics job disabled'
    );
    return;
  }

  const outer = setTimeout(() => {
    void pollKorinMetrics();
    setInterval(
      () => void pollKorinMetrics(),
      korinConfig.pollIntervalMs
    ).unref();
  }, STARTUP_DELAY_MS);
  outer.unref();

  log.info('IRC metrics job scheduled', {
    startupDelayMs: STARTUP_DELAY_MS,
    intervalMs: korinConfig.pollIntervalMs
  });
};
