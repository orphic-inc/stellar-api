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
  inviteRefusalMsg,
  INVITE_GATE_ORDER,
  INVITE_REFUSAL,
  SPEND,
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

/**
 * The words, as structure rather than as strings (#656).
 *
 * The per-message copy is pinned at the route level, on both surfaces, in
 * profile.spec.ts and profileInvites.spec.ts. What is pinned HERE is the shape
 * every entry must have, which is what an eighth refusal added later would
 * otherwise get wrong — `invites_revoked` is how the seventh came to be the odd
 * one out, carrying a past-tense clause its six siblings did not.
 */
describe('invite refusal copy', () => {
  const ENTRIES = INVITE_GATE_ORDER.map(
    (reason) => [reason, INVITE_REFUSAL[reason]] as const
  );

  // The one send-specific clause. Baked into a `base`, it would reappear on the
  // eligibility page, telling a member who has typed nothing that an invite
  // they never created was not used — the whole of #656.
  it.each(ENTRIES)('%s: the base carries no send-only clause', (_, copy) => {
    expect(copy.base).not.toContain(SPEND);
    expect(copy.base).not.toMatch(/was not (used|sent)/i);
  });

  // stellar-ui linkifies a path anchored to the END of the message
  // (`TRAILING_PATH` in InviteForm.tsx). A path inside `base` would sit before
  // the spend clause on a send, and the Staff PM link would quietly become
  // plain text. Nothing on the ui side can catch that.
  it.each(ENTRIES)('%s: the base does not end with a path', (_, copy) => {
    expect(copy.base).not.toMatch(/(\/[a-z0-9/-]+)\s*$/i);
  });

  it.each(ENTRIES)('%s: the base is a full sentence', (_, copy) => {
    expect(copy.base).toMatch(/\.$/);
  });

  it.each(ENTRIES)('%s: says nothing about a send when none was made', (r) => {
    expect(inviteRefusalMsg(r, { sent: false })).not.toContain(SPEND);
  });

  it.each(ENTRIES.filter(([, c]) => c.pointer))(
    '%s: the pointer stays last, on both surfaces',
    (reason, copy) => {
      for (const sent of [true, false]) {
        expect(inviteRefusalMsg(reason, { sent })).toMatch(
          new RegExp(`${copy.pointer?.replace(/[/]/g, '\\/')}$`)
        );
      }
    }
  );

  // "You have no invites remaining. Your invite was not used." contradicts
  // itself: there was none to use.
  it('no_invites reads the same before and after a send', () => {
    expect(inviteRefusalMsg('no_invites', { sent: true })).toBe(
      inviteRefusalMsg('no_invites', { sent: false })
    );
  });

  it('every other refusal reassures the sender, and only the sender', () => {
    for (const [reason, copy] of ENTRIES) {
      if (!copy.spends) continue;
      expect(inviteRefusalMsg(reason, { sent: true })).toContain(SPEND);
      expect(inviteRefusalMsg(reason, { sent: false })).not.toContain(SPEND);
    }
  });
});
