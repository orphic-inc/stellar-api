/**
 * Background job driving the asset orphan sweep (ADR-0026 Phase 2, #342). Same
 * shape as `linkHealthJob`: a startup delay so a booting container is not doing
 * collection work while it seeds, then a daily cycle.
 */
import { getLogger } from './logging';
import { sweepOrphanedAssets } from './assetSweep';

const log = getLogger('assetSweepJob');

const INTERVAL_MS = 24 * 60 * 60 * 1000; // every 24 hours
const STARTUP_DELAY_MS = 5 * 60_000; // 5 minutes after boot

const runCycle = async (): Promise<void> => {
  await sweepOrphanedAssets().catch((err) =>
    log.error('Asset orphan sweep failed', { err })
  );
};

export const startAssetSweepJob = (): void => {
  const outer = setTimeout(() => {
    void runCycle();
    setInterval(() => void runCycle(), INTERVAL_MS).unref();
  }, STARTUP_DELAY_MS);
  outer.unref();

  log.info('Asset sweep job scheduled', {
    startupDelayMs: STARTUP_DELAY_MS,
    intervalMs: INTERVAL_MS
  });
};
