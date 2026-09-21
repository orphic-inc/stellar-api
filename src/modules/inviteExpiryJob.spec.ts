/**
 * Unit tests for the invite-expiry sweep's member-facing half (#627, ADR-0041).
 *
 * The lapse rule is pure and covered by inviteExpiry.spec.ts; the claim, the
 * refund and the races between them are covered against a real database by
 * inviteExpiry.integration.ts. What is pinned HERE is the PM, which had no test
 * of any kind before #685 — the copy could change in either direction and
 * nothing noticed.
 *
 * The rule worth guarding is not the wording but what the wording may claim: a
 * system PM states what the SWEEP knows, and never what the member may do next.
 * Seven gates own that (ADR-0043) and not one of them is visible from this
 * module, so a promise made here is false for whichever gate happens to apply —
 * a closed site, a full one, ratio watch, poor standing or disabled downloads.
 */
import { pmMock, prismaMock, resetApiTestState } from '../test/apiTestHarness';

jest.mock('./logging', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

import { notifyInviteExpired } from './inviteExpiryJob';

// The harness already mocks `modules/pm`, so this reads its jest.fn rather than
// registering a second mock of the same module — two registrations race and the
// module under test sees only one of them.
const mockSendSystemMessage = pmMock.sendSystemMessage;

const INVITE = { id: 7, inviterId: 3, email: 'someone@example.com' };

/**
 * Phrasings the body must never use. `you can invite` is the literal sentence
 * #685 removed; the looser forms are here because matching only the original
 * would let it back in under a rewrite, which is the regression that matters.
 */
const CAPABILITY_CLAIMS = [/you can\b/i, /you may\b/i, /you are able/i];

/** The single PM this call sent, as [recipient, subject, body]. */
const sent = () =>
  mockSendSystemMessage.mock.calls[0] as [number, string, string];

const inviterCanInvite = (canInvite: boolean) =>
  prismaMock.user.findUnique.mockResolvedValue({ canInvite } as never);

beforeEach(() => {
  resetApiTestState();
  // Reset only. `sendSystemMessage`'s return value is never read here, and a
  // typed `mockResolvedValue` would have to fabricate a whole conversation.
  mockSendSystemMessage.mockReset();
});

describe('notifyInviteExpired — what the PM may claim', () => {
  it.each([
    ['refunded', true],
    ['unrefunded', false]
  ])('states the address is free and promises no send (%s)', async (_, r) => {
    inviterCanInvite(true);

    await notifyInviteExpired({ ...INVITE, refunded: r as boolean });

    const [, , body] = sent();
    expect(body).toContain('no longer held');
    for (const claim of CAPABILITY_CLAIMS) {
      expect(body).not.toMatch(claim);
    }
  });

  it('names the address it expired against, so the member knows which', async () => {
    inviterCanInvite(true);

    await notifyInviteExpired({ ...INVITE, refunded: true });

    const [recipient, , body] = sent();
    expect(recipient).toBe(INVITE.inviterId);
    expect(body).toContain(INVITE.email);
  });

  // The refund is the one thing the sweep can promise, because it already did
  // it — the increment committed before this function was called.
  it('says the invite came back only when it actually did', async () => {
    inviterCanInvite(true);
    await notifyInviteExpired({ ...INVITE, refunded: true });
    expect(sent()[2]).toContain('returned to you');

    mockSendSystemMessage.mockClear();
    inviterCanInvite(true);
    await notifyInviteExpired({ ...INVITE, refunded: false });
    expect(sent()[2]).not.toContain('returned to you');
  });
});

describe('notifyInviteExpired — who hears about it', () => {
  /**
   * A revoked member's invites lapsed because staff revoked them, not because
   * time ran out, so "Your invite expired" would blame the clock for a
   * moderation act. Staff tell them about the revoke itself.
   */
  it('sends nothing to an inviter whose invite privileges are revoked', async () => {
    inviterCanInvite(false);

    await notifyInviteExpired({ ...INVITE, refunded: true });

    expect(mockSendSystemMessage).not.toHaveBeenCalled();
  });

  it('sends to an inviter who still holds the privilege', async () => {
    inviterCanInvite(true);

    await notifyInviteExpired({ ...INVITE, refunded: true });

    expect(mockSendSystemMessage).toHaveBeenCalledTimes(1);
  });

  // The refund has already committed, so a PM that throws must not surface as a
  // cycle failure and must not be retried into a double message.
  it('swallows a failed send rather than failing the cycle', async () => {
    inviterCanInvite(true);
    mockSendSystemMessage.mockRejectedValue(new Error('inbox full'));

    await expect(
      notifyInviteExpired({ ...INVITE, refunded: true })
    ).resolves.toBeUndefined();
  });
});
