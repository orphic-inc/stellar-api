import {
  INVITE_TTL_DAYS,
  inviteExpiresAt,
  isAddressFree,
  isInviteLapsed,
  type InviteLapseInput
} from './inviteExpiry';
import { DAY_MS } from './inviteGrant';

const now = new Date('2026-09-14T12:00:00Z');
const later = new Date(now.getTime() + 1);
const invite = (over: Partial<InviteLapseInput> = {}): InviteLapseInput => ({
  status: 'pending',
  expires: later,
  inviterDisabled: false,
  inviterCanInvite: true,
  ...over
});

describe('inviteExpiresAt', () => {
  it('is INVITE_TTL_DAYS after the send', () => {
    expect(inviteExpiresAt(now).getTime() - now.getTime()).toBe(
      INVITE_TTL_DAYS * DAY_MS
    );
  });
});

describe('isInviteLapsed', () => {
  it('keeps a pending invite live until its expiry', () => {
    expect(isInviteLapsed(invite(), now)).toBe(false);
  });

  it('lapses a pending invite at its expiry, not a millisecond later', () => {
    // The claim predicate is `expires <= now`; the two must agree at the edge.
    expect(isInviteLapsed(invite({ expires: now }), now)).toBe(true);
  });

  it('lapses a live-dated pending invite whose inviter is disabled', () => {
    expect(isInviteLapsed(invite({ inviterDisabled: true }), now)).toBe(true);
  });

  it('lapses a live-dated pending invite whose inviter had invite privileges revoked (#636)', () => {
    expect(isInviteLapsed(invite({ inviterCanInvite: false }), now)).toBe(true);
  });

  it.each(['expired', 'cancelled'] as const)(
    'treats a stored %s status as lapsed whatever its date',
    (status) => {
      expect(isInviteLapsed(invite({ status }), now)).toBe(true);
    }
  );

  it('never lapses an accepted invite, even past its date or with a disabled inviter', () => {
    // An accepted invite was used. Treating it as lapsed would free the address
    // for a second invite and hand the inviter a refund for a success.
    expect(
      isInviteLapsed(
        invite({
          status: 'accepted',
          expires: now,
          inviterDisabled: true,
          inviterCanInvite: false
        }),
        now
      )
    ).toBe(false);
  });
});

describe('isAddressFree', () => {
  const earlier = new Date(now.getTime() - 1);

  it("holds a cancelled invite's address until its original expiry (#640)", () => {
    // Otherwise send → withdraw → send could mail one address without limit.
    expect(isAddressFree(invite({ status: 'cancelled' }), now)).toBe(false);
    expect(
      isAddressFree(invite({ status: 'cancelled', expires: now }), now)
    ).toBe(true);
  });

  it('frees an expired address whatever its date', () => {
    expect(isAddressFree(invite({ status: 'expired' }), now)).toBe(true);
  });

  it('frees a lapsed pending address and holds a live one', () => {
    expect(isAddressFree(invite({ expires: earlier }), now)).toBe(true);
    expect(isAddressFree(invite(), now)).toBe(false);
  });

  it('never frees an accepted address', () => {
    expect(
      isAddressFree(invite({ status: 'accepted', expires: earlier }), now)
    ).toBe(false);
  });
});
