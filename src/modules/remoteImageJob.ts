/**
 * Background job driving the remote image import (#737, ADR-0051). Each cycle
 * leases the due `pending` rows and imports them a few at a time
 * (`processDueRemoteImages`). A write only records a URL; this is what fetches
 * it, so the interval is roughly how long a new image renders as a link first.
 */
import { imageImport } from './config';
import { getLogger } from './logging';
import { processDueRemoteImages } from './remoteImage';

const log = getLogger('remoteImageJob');

const STARTUP_DELAY_MS = 30_000; // let a booting container finish seeding first

let running = false;

const runCycle = async (): Promise<void> => {
  // A slow host can hold a cycle past the interval; never stack a second one.
  if (running) return;
  running = true;
  try {
    await processDueRemoteImages();
  } catch (err) {
    log.error('Remote image import cycle failed', { err });
  } finally {
    running = false;
  }
};

export const startRemoteImageJob = (): void => {
  const outer = setTimeout(() => {
    void runCycle();
    setInterval(() => void runCycle(), imageImport.intervalMs).unref();
  }, STARTUP_DELAY_MS);
  outer.unref();

  log.info('Remote image import job scheduled', {
    startupDelayMs: STARTUP_DELAY_MS,
    intervalMs: imageImport.intervalMs
  });
};
