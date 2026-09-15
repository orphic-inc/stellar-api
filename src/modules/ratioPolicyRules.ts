/**
 * The ratio policy state machine (#646, ADR-0044 §4). Pure: the caller loads
 * the row, the ratio stats and the member's `consumed`, and passes a clock, so
 * every transition is testable without a database.
 *
 * Two callers apply these rules — the evaluation after a download, and the
 * daily sweep — through the same claim in `ratioPolicy.ts`, so they cannot
 * drift. Staff overrides do not pass through here: they are absolute writes.
 *
 *  - Only a `RATIO` disable lifts. A `STAFF` disable is reversed by staff only.
 *  - Starting a watch is download-triggered. The sweep passes
 *    `allowWatchStart: false`, because a probation started while a member is
 *    idle would hand them a disable they had no chance to avoid.
 *  - A lift returns to `OK`, exactly like leaving a watch, not to a fresh
 *    watch: meeting the requirement is the whole condition for both.
 */
import { RatioDisableCause, RatioPolicyStatus } from '@prisma/client';

export const WATCH_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const WATCH_DOWNLOAD_LIMIT = BigInt(10 * 1024 ** 3); // 10 GiB

/** The fields of a policy row the rules read, and the claim matches on. */
export interface PolicyRow {
  status: RatioPolicyStatus;
  disabledCause: RatioDisableCause | null;
  watchStartedAt: Date | null;
  watchExpiresAt: Date | null;
  consumedAtWatchStart: bigint | null;
}

export interface RatioReading {
  meetsRequirement: boolean;
  requiredRatio: number;
}

export type RatioTransition =
  | { kind: 'watch_started' }
  | { kind: 'watch_cleared' }
  | { kind: 'download_disabled'; trigger: 'download_limit' | 'watch_expired' }
  | { kind: 'download_restored' };

export interface RuleOptions {
  /** False for the sweep: only a download may start a watch. */
  allowWatchStart: boolean;
}

const fromWatch = (
  row: PolicyRow,
  ratio: RatioReading,
  consumed: bigint,
  now: Date
): RatioTransition | null => {
  if (ratio.meetsRequirement) return { kind: 'watch_cleared' };
  const consumedDuringWatch =
    row.consumedAtWatchStart === null
      ? 0n
      : consumed - row.consumedAtWatchStart;
  if (consumedDuringWatch >= WATCH_DOWNLOAD_LIMIT) {
    return { kind: 'download_disabled', trigger: 'download_limit' };
  }
  if (row.watchExpiresAt !== null && now >= row.watchExpiresAt) {
    return { kind: 'download_disabled', trigger: 'watch_expired' };
  }
  return null;
};

/** The one transition the rules make from `row` now, or `null` for none. */
export const decideRatioTransition = (
  row: PolicyRow,
  ratio: RatioReading,
  consumed: bigint,
  now: Date,
  { allowWatchStart }: RuleOptions
): RatioTransition | null => {
  switch (row.status) {
    case RatioPolicyStatus.OK:
      return allowWatchStart &&
        !ratio.meetsRequirement &&
        ratio.requiredRatio > 0
        ? { kind: 'watch_started' }
        : null;
    case RatioPolicyStatus.WATCH:
      return fromWatch(row, ratio, consumed, now);
    case RatioPolicyStatus.DOWNLOAD_DISABLED:
      return row.disabledCause === RatioDisableCause.RATIO &&
        ratio.meetsRequirement
        ? { kind: 'download_restored' }
        : null;
  }
};

/** The row a transition writes, and the `canDownload` it leaves. */
export const transitionTarget = (
  transition: RatioTransition,
  consumed: bigint,
  now: Date
) => {
  const cleared = {
    status: RatioPolicyStatus.OK,
    watchStartedAt: null,
    watchExpiresAt: null,
    consumedAtWatchStart: null,
    downloadDisabledAt: null,
    disabledCause: null
  };
  switch (transition.kind) {
    case 'watch_started':
      return {
        row: {
          ...cleared,
          status: RatioPolicyStatus.WATCH,
          watchStartedAt: now,
          watchExpiresAt: new Date(now.getTime() + WATCH_DURATION_MS),
          consumedAtWatchStart: consumed
        },
        canDownload: true
      };
    case 'download_disabled':
      // The watch fields stay: they are what the backfill read, and they show
      // staff which watch this disable ended.
      return {
        row: {
          status: RatioPolicyStatus.DOWNLOAD_DISABLED,
          disabledCause: RatioDisableCause.RATIO,
          downloadDisabledAt: now
        },
        canDownload: false
      };
    case 'watch_cleared':
    case 'download_restored':
      return { row: cleared, canDownload: true };
  }
};
