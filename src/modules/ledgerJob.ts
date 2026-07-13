import { prisma } from '../lib/prisma';
import { korin } from './config';
import { getLogger } from './logging';
import { getNewConsumptionEvents, pushConsumptionEvent } from './ledger';

const log = getLogger('ledgerJob');

const STARTUP_DELAY_MS = 30_000; // align with the announce/metrics jobs; let boot settle

// In-process cursor (v0.x — matches the stateless announce/metrics posture).
// Initialised to the latest grant at startup so a restart never re-emits history;
// korin already holds those from the boot snapshot (ADR-0016 bounded-loss model).
let cursor = 0;

const tick = async (): Promise<void> => {
  const events = await getNewConsumptionEvents(cursor);
  for (const event of events) {
    const ok = await pushConsumptionEvent(event);
    if (!ok) return; // leave cursor; retry from here next tick
    cursor = event.grantId;
  }
};

export const startLedgerJob = (): void => {
  if (!korin.apiUrl || !korin.pullKey) {
    log.warn(
      'KORIN_API_URL or KORIN_PULL_KEY not configured — consumption-event push disabled'
    );
    return;
  }

  const outer = setTimeout(() => {
    void (async () => {
      const latest = await prisma.downloadAccessGrant.aggregate({
        _max: { id: true }
      });
      cursor = latest._max.id ?? 0;
      log.info('Consumption-event push job started', { cursor });
      void tick();
      setInterval(() => void tick(), korin.pollIntervalMs).unref();
    })();
  }, STARTUP_DELAY_MS);
  outer.unref();
};
