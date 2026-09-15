/**
 * Table-driven tests for the pure ratio policy rules (#646, ADR-0044 §4).
 *
 * No DB mock: the module has no I/O. Every transition is pinned here, including
 * the ones that are easy to regress into something that looks equivalent — a
 * staff disable never lifting, the sweep never starting a watch, and the 10 GiB
 * rule reading a pre-#646 staff watch's null start as nothing consumed.
 */
import { RatioDisableCause, RatioPolicyStatus } from '@prisma/client';
import {
  decideRatioTransition,
  transitionTarget,
  WATCH_DOWNLOAD_LIMIT,
  WATCH_DURATION_MS,
  type PolicyRow
} from './ratioPolicyRules';

const NOW = new Date('2026-09-15T12:00:00Z');
const GiB = BigInt(1024 ** 3);
const DOWNLOAD = { allowWatchStart: true };
const SWEEP = { allowWatchStart: false };

const MEETS = { meetsRequirement: true, requiredRatio: 0.3 };
const SHORT = { meetsRequirement: false, requiredRatio: 0.3 };

const row = (overrides: Partial<PolicyRow> = {}): PolicyRow => ({
  status: RatioPolicyStatus.OK,
  disabledCause: null,
  watchStartedAt: null,
  watchExpiresAt: null,
  consumedAtWatchStart: null,
  ...overrides
});

const watch = (overrides: Partial<PolicyRow> = {}) =>
  row({
    status: RatioPolicyStatus.WATCH,
    watchStartedAt: new Date(NOW.getTime() - 3 * 86_400_000),
    watchExpiresAt: new Date(NOW.getTime() + 11 * 86_400_000),
    consumedAtWatchStart: 20n * GiB,
    ...overrides
  });

const disabled = (disabledCause: RatioDisableCause) =>
  row({ status: RatioPolicyStatus.DOWNLOAD_DISABLED, disabledCause });

/** [name, row, ratio, consumed, options, expected transition] */
const CASES = [
  ['OK, meets', row(), MEETS, 20n * GiB, DOWNLOAD, null],
  [
    'OK, short, after a download',
    row(),
    SHORT,
    20n * GiB,
    DOWNLOAD,
    { kind: 'watch_started' }
  ],
  ['OK, short, from the sweep', row(), SHORT, 20n * GiB, SWEEP, null],
  [
    'OK, short but nothing required',
    row(),
    { meetsRequirement: false, requiredRatio: 0 },
    2n * GiB,
    DOWNLOAD,
    null
  ],
  ['WATCH, meets', watch(), MEETS, 25n * GiB, SWEEP, { kind: 'watch_cleared' }],
  ['WATCH, short, within limits', watch(), SHORT, 25n * GiB, SWEEP, null],
  [
    'WATCH, short, 10 GiB consumed during it',
    watch(),
    SHORT,
    20n * GiB + WATCH_DOWNLOAD_LIMIT,
    DOWNLOAD,
    { kind: 'download_disabled', trigger: 'download_limit' }
  ],
  [
    'WATCH, short, just under 10 GiB',
    watch(),
    SHORT,
    20n * GiB + WATCH_DOWNLOAD_LIMIT - 1n,
    DOWNLOAD,
    null
  ],
  [
    'WATCH, short, expired',
    watch({ watchExpiresAt: new Date(NOW.getTime() - 1) }),
    SHORT,
    21n * GiB,
    SWEEP,
    { kind: 'download_disabled', trigger: 'watch_expired' }
  ],
  [
    'WATCH, meets, expired: leaving wins',
    watch({ watchExpiresAt: new Date(NOW.getTime() - 1) }),
    MEETS,
    21n * GiB,
    SWEEP,
    { kind: 'watch_cleared' }
  ],
  [
    'WATCH, short, over the limit and expired: the limit is named',
    watch({ watchExpiresAt: new Date(NOW.getTime() - 1) }),
    SHORT,
    40n * GiB,
    SWEEP,
    { kind: 'download_disabled', trigger: 'download_limit' }
  ],
  [
    'a pre-#646 staff WATCH with no start reads as nothing consumed',
    watch({ consumedAtWatchStart: null }),
    SHORT,
    500n * GiB,
    DOWNLOAD,
    null
  ],
  [
    'RATIO disable, meets',
    disabled(RatioDisableCause.RATIO),
    MEETS,
    30n * GiB,
    SWEEP,
    { kind: 'download_restored' }
  ],
  [
    'RATIO disable, short',
    disabled(RatioDisableCause.RATIO),
    SHORT,
    30n * GiB,
    SWEEP,
    null
  ],
  [
    'STAFF disable, meets',
    disabled(RatioDisableCause.STAFF),
    MEETS,
    30n * GiB,
    SWEEP,
    null
  ],
  [
    'STAFF disable, meets, after a download',
    disabled(RatioDisableCause.STAFF),
    MEETS,
    30n * GiB,
    DOWNLOAD,
    null
  ]
] as const;

describe('decideRatioTransition', () => {
  it.each(CASES)('%s', (_, from, ratio, consumed, options, expected) => {
    expect(decideRatioTransition(from, ratio, consumed, NOW, options)).toEqual(
      expected
    );
  });
});

describe('transitionTarget', () => {
  it('starts a watch from now and the current consumed, downloads still open', () => {
    expect(transitionTarget({ kind: 'watch_started' }, 20n * GiB, NOW)).toEqual(
      {
        row: {
          status: RatioPolicyStatus.WATCH,
          watchStartedAt: NOW,
          watchExpiresAt: new Date(NOW.getTime() + WATCH_DURATION_MS),
          consumedAtWatchStart: 20n * GiB,
          downloadDisabledAt: null,
          disabledCause: null
        },
        canDownload: true
      }
    );
  });

  it('disables with cause RATIO and leaves the watch fields as they were', () => {
    const target = transitionTarget(
      { kind: 'download_disabled', trigger: 'watch_expired' },
      20n * GiB,
      NOW
    );

    expect(target).toEqual({
      row: {
        status: RatioPolicyStatus.DOWNLOAD_DISABLED,
        disabledCause: RatioDisableCause.RATIO,
        downloadDisabledAt: NOW
      },
      canDownload: false
    });
  });

  it.each(['watch_cleared', 'download_restored'] as const)(
    '%s clears every field back to OK and restores downloads',
    (kind) => {
      expect(transitionTarget({ kind }, 20n * GiB, NOW)).toEqual({
        row: {
          status: RatioPolicyStatus.OK,
          watchStartedAt: null,
          watchExpiresAt: null,
          consumedAtWatchStart: null,
          downloadDisabledAt: null,
          disabledCause: null
        },
        canDownload: true
      });
    }
  );
});
