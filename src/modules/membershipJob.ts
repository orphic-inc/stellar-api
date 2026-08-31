/**
 * Periodic membership reconcile (ADR-0030 Decision 4, #328).
 *
 * Walks every PRIVATE community once per tick and projects its full eligible
 * verified-nick set to korin, which overwrites the channel ACL from it.
 *
 * **A dedicated job, deliberately not folded into `announceJob`.** The two have
 * different triggers and different failure postures: announce is an ordered,
 * cursor-held firehose over new contributions, while this is an idempotent
 * full-set replace over a set of communities that may see no contributions for
 * weeks. Sharing announceJob's cursor would couple a membership outage to the
 * announce stream — the exact wedge ADR-0030 rules out.
 *
 * Reuses `KORIN_POLL_INTERVAL_MS` — the same cadence value as the metrics and
 * announce jobs, not the same timer.
 */
import { korin } from './config';
import { getLogger } from './logging';
import {
  listPrivateCommunityIds,
  reconcileCommunityMembership
} from './membershipProjection';

const log = getLogger('membershipJob');

const STARTUP_DELAY_MS = 30_000; // align with the other korin jobs; let boot settle

export interface ReconcileResult {
  attempted: number;
  succeeded: number;
}

/**
 * One reconcile pass over every PRIVATE community.
 *
 * **No cursor, and a failure never stops the pass.** This is the deliberate
 * difference from `runAnnounceCycle`, which holds its cursor at the first
 * failure to preserve ordering. A full-set projection is idempotent and
 * order-free: community B's ACL has nothing to do with community A's, so
 * stopping at A would strand B for no reason. Every failure is simply retried
 * whole on the next tick.
 */
export const runMembershipReconcileCycle =
  async (): Promise<ReconcileResult> => {
    const ids = await listPrivateCommunityIds();
    let succeeded = 0;
    for (const id of ids) {
      if (await reconcileCommunityMembership(id)) succeeded++;
    }
    if (ids.length > 0 && succeeded < ids.length) {
      log.warn('Some community ACLs were not projected; retrying next tick', {
        attempted: ids.length,
        succeeded
      });
    }
    return { attempted: ids.length, succeeded };
  };

const tick = async (): Promise<void> => {
  await runMembershipReconcileCycle();
};

export const startMembershipJob = (): void => {
  if (!korin.apiUrl || !korin.pullKey) {
    log.warn(
      'KORIN_API_URL or KORIN_PULL_KEY not configured — membership reconcile disabled'
    );
    return;
  }

  const outer = setTimeout(() => {
    log.info('Membership reconcile job started', {
      intervalMs: korin.pollIntervalMs
    });
    void tick();
    setInterval(() => void tick(), korin.pollIntervalMs).unref();
  }, STARTUP_DELAY_MS);
  outer.unref();
};
