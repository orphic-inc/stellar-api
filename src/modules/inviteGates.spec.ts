/**
 * Table-driven tests for the pure invite send gates (#637, ADR-0043).
 *
 * No DB mock: the module has no I/O. Each gate is pinned alone, and every pair
 * is pinned in order, because the order is the decision — a revoked member on a
 * full site must hear about the revoke. Loading the state against a real
 * database is inviteGates.integration.ts's.
 */
import { RatioPolicyStatus } from '@prisma/client';
import {
  firstInviteRefusal,
  isOnRatioWatch,
  INVITE_GATE_ORDER,
  type InviteGateInput,
  type InviteGateRefusal
} from './inviteGates';

const OPEN: InviteGateInput = {
  canInvite: true,
  canDownload: true,
  standing: 'clean',
  onRatioWatch: false,
  registrationClosed: false,
  siteFull: false,
  balance: 1,
  unlimited: false
};

/** The one change to OPEN that closes each gate. */
const CLOSE: Record<InviteGateRefusal, Partial<InviteGateInput>> = {
  invites_revoked: { canInvite: false },
  downloads_disabled: { canDownload: false },
  poor_standing: { standing: 'poor' },
  ratio_watch: { onRatioWatch: true },
  registration_closed: { registrationClosed: true },
  site_full: { siteFull: true },
  no_invites: { balance: 0 }
};

describe('firstInviteRefusal', () => {
  it('lets a member with every gate open send', () => {
    expect(firstInviteRefusal(OPEN)).toBeNull();
  });

  it.each(INVITE_GATE_ORDER)('refuses %s on its own', (reason) => {
    expect(firstInviteRefusal({ ...OPEN, ...CLOSE[reason] })).toBe(reason);
  });

  const pairs = INVITE_GATE_ORDER.flatMap((earlier, i) =>
    INVITE_GATE_ORDER.slice(i + 1).map((later) => [earlier, later] as const)
  );

  it.each(pairs)('names %s over %s', (earlier, later) => {
    expect(
      firstInviteRefusal({ ...OPEN, ...CLOSE[later], ...CLOSE[earlier] })
    ).toBe(earlier);
  });

  // The generated pairs above cannot catch a transposition: they are derived
  // from INVITE_GATE_ORDER, so they move with it. This is the guard that pins
  // the decision — including registration_closed above site_full (#673), which
  // ADR-0043 §1's "what the member fixes first" rule does not decide.
  it('orders staff decisions, then member state, then capacity and balance', () => {
    expect(INVITE_GATE_ORDER).toEqual([
      'invites_revoked',
      'downloads_disabled',
      'poor_standing',
      'ratio_watch',
      'registration_closed',
      'site_full',
      'no_invites'
    ]);
  });

  it.each([
    ['pristine', null],
    ['clean', null],
    ['neutral', null],
    ['poor', 'poor_standing'],
    ['hammer', 'poor_standing']
  ] as const)(
    'reads %s standing the way the handout does',
    (standing, expected) => {
      expect(firstInviteRefusal({ ...OPEN, standing })).toBe(expected);
    }
  );
});

describe('firstInviteRefusal for an unlimited sender (ADR-0043 §5)', () => {
  const UNLIMITED = { ...OPEN, unlimited: true, balance: 0 };

  it('never refuses them for the balance', () => {
    expect(firstInviteRefusal(UNLIMITED)).toBeNull();
  });

  it.each(INVITE_GATE_ORDER.filter((reason) => reason !== 'no_invites'))(
    'still refuses %s',
    (reason) => {
      expect(firstInviteRefusal({ ...UNLIMITED, ...CLOSE[reason] })).toBe(
        reason
      );
    }
  );
});

describe('isOnRatioWatch', () => {
  it.each([
    [RatioPolicyStatus.WATCH, false, true],
    // Recovered without a download: the row still says WATCH.
    [RatioPolicyStatus.WATCH, true, false],
    [RatioPolicyStatus.OK, false, false],
    [RatioPolicyStatus.DOWNLOAD_DISABLED, false, false],
    [null, false, false]
  ] as const)('status %s, meets requirement %s → %s', (status, meets, on) => {
    expect(isOnRatioWatch(status, meets)).toBe(on);
  });
});
