import { prisma } from '../lib/prisma';
import { korin } from './config';
import { getLogger } from './logging';
import { getNewAnnounceItems, publishAnnounceItem } from './announce';

const log = getLogger('announceJob');

const STARTUP_DELAY_MS = 30_000; // align with the metrics job; let boot settle

// In-process cursor (v0.x — matches the stateless announce/metrics posture).
// Initialised to the latest contribution at startup so a restart never
// re-announces history; only contributions created after boot are pushed.
let cursor = 0;

/**
 * Push every contribution newer than `from` to korin, in id order, and return
 * the cursor to resume from. Stops at the first push failure so that item (and
 * everything after it) is retried on the next cycle — at-least-once, in-order,
 * never skipping. Successfully-pushed items advance the returned cursor even
 * when a later item in the same batch fails.
 */
export const runAnnounceCycle = async (from: number): Promise<number> => {
  let resume = from;
  const items = await getNewAnnounceItems(resume);
  for (const item of items) {
    const ok = await publishAnnounceItem(item);
    if (!ok) return resume; // hold here; retry from this item next cycle
    resume = item.id;
  }
  return resume;
};

const tick = async (): Promise<void> => {
  cursor = await runAnnounceCycle(cursor);
};

export const startAnnounceJob = (): void => {
  if (!korin.apiUrl || !korin.pullKey) {
    log.warn(
      'KORIN_API_URL or KORIN_PULL_KEY not configured — announce push disabled'
    );
    return;
  }

  const outer = setTimeout(() => {
    void (async () => {
      const latest = await prisma.contribution.aggregate({
        _max: { id: true }
      });
      cursor = latest._max.id ?? 0;
      log.info('Announce push job started', { cursor });
      void tick();
      setInterval(() => void tick(), korin.pollIntervalMs).unref();
    })();
  }, STARTUP_DELAY_MS);
  outer.unref();
};
