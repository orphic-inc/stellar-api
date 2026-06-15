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

const tick = async (): Promise<void> => {
  const items = await getNewAnnounceItems(cursor);
  for (const item of items) {
    const ok = await publishAnnounceItem(item);
    if (!ok) return; // leave cursor; retry from here next tick
    cursor = item.id;
  }
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
