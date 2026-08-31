import { prisma } from '../lib/prisma';
import { korin } from './config';
import { getLogger } from './logging';
import {
  getNewAnnounceItems,
  publishAnnounceItem,
  announceTarget,
  AnnounceItem
} from './announce';
import { reconcileCommunityMembership } from './membershipProjection';

const log = getLogger('announceJob');

const STARTUP_DELAY_MS = 30_000; // align with the metrics job; let boot settle

// In-process cursor (v0.x — matches the stateless announce/metrics posture).
// Initialised to the latest contribution at startup so a restart never
// re-announces history; only contributions created after boot are pushed.
let cursor = 0;

/**
 * Freshen a private community's channel ACL immediately before its line is
 * routed (ADR-0030 Decision 4, #328), so the first announce after a membership
 * change lands in an up-to-date `#c-<id>` rather than waiting for the periodic
 * reconcile tick.
 *
 * **Strictly best-effort — this must never gate the announce.** Projection and
 * delivery are independent failure domains sharing one ordered cursor: if a
 * membership push fails and we held the cursor for it, a single
 * `/irc/membership` outage would wedge the entire ordered announce firehose,
 * public communities included. The periodic tick self-heals the ACL anyway, and
 * a stale ACL is costless here because the flag gates announcement *visibility
 * only, never a download* (ADR-0015, Golden Rule 3).
 *
 * Hence the catch-all: `reconcileCommunityMembership` returns false for a failed
 * push, but its DB reads can still throw, and an exception escaping here would
 * abort the cycle — gating the announce by the back door, which is exactly what
 * the design forbids.
 *
 * Which items are private is decided by `announceTarget`, the same function that
 * builds the routing target, so the piggyback and the routing can never disagree
 * about what "private" means.
 */
const piggybackMembershipProjection = async (
  item: AnnounceItem
): Promise<void> => {
  const target = announceTarget(item);
  if (!target) return; // public path — no gated channel to freshen

  try {
    const ok = await reconcileCommunityMembership(target.community);
    if (!ok) {
      log.warn(
        'Membership projection failed before a private announce; routing anyway',
        { contributionId: item.id, communityId: target.community }
      );
    }
  } catch (err) {
    log.error('Membership projection threw before a private announce', {
      contributionId: item.id,
      communityId: target.community,
      err: err instanceof Error ? err.message : String(err)
    });
  }
};

/**
 * Push every contribution newer than `from` to korin, in id order, and return
 * the cursor to resume from. Stops at the first push failure so that item (and
 * everything after it) is retried on the next cycle — at-least-once, in-order,
 * never skipping. Successfully-pushed items advance the returned cursor even
 * when a later item in the same batch fails.
 *
 * A private item's ACL is refreshed first (above), but only the *publish*
 * result decides the cursor.
 */
export const runAnnounceCycle = async (from: number): Promise<number> => {
  let resume = from;
  const items = await getNewAnnounceItems(resume);
  for (const item of items) {
    await piggybackMembershipProjection(item);
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
