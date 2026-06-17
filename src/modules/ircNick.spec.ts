/**
 * Unit tests for IRC nick verification (ADR-0015). Prisma is mocked; the
 * (fromNick, code) binding and the claim/verify lifecycle are exercised here.
 */
import { Prisma } from '@prisma/client';

const mockPrismaUser = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  update: jest.fn()
};

jest.mock('../lib/prisma', () => ({
  prisma: { user: mockPrismaUser }
}));

import {
  generateVerificationCode,
  claimIrcNick,
  clearIrcNick,
  verifyIrcNick,
  NONCE_TTL_MS
} from './ircNick';

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── generateVerificationCode ────────────────────────────────────────────────

describe('generateVerificationCode', () => {
  it('is 8 chars from the unambiguous alphabet (no I, L, O, 0, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateVerificationCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });
});

// ─── claimIrcNick ────────────────────────────────────────────────────────────

describe('claimIrcNick', () => {
  it('writes pendingIrcNick + a fresh code + expiry, leaving ircNick untouched', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null); // nobody holds the nick
    mockPrismaUser.update.mockResolvedValue({});

    const before = Date.now();
    const result = await claimIrcNick(7, 'Alice');

    expect(result.alreadyVerified).toBe(false);
    expect(result.code).toMatch(/^[A-Z2-9]{8}$/);
    const update = mockPrismaUser.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 7 });
    expect(update.data.pendingIrcNick).toBe('Alice');
    expect(update.data.ircNickNonce).toBe(result.code);
    expect(update.data).not.toHaveProperty('ircNick'); // verified binding untouched
    const ttl = update.data.ircNickNonceExpiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(NONCE_TTL_MS - 5000);
    expect(ttl).toBeLessThanOrEqual(NONCE_TTL_MS + 1000);
  });

  it('throws 409 when the nick is already verified to a different account', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({ id: 99 });
    await expect(claimIrcNick(7, 'Alice')).rejects.toMatchObject({
      statusCode: 409
    });
    expect(mockPrismaUser.update).not.toHaveBeenCalled();
  });

  it('is a no-op (alreadyVerified) when the caller already owns the verified nick', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({ id: 7 });
    const result = await claimIrcNick(7, 'Alice');
    expect(result.alreadyVerified).toBe(true);
    expect(result.code).toBe('');
    expect(mockPrismaUser.update).not.toHaveBeenCalled();
  });
});

// ─── clearIrcNick ────────────────────────────────────────────────────────────

describe('clearIrcNick', () => {
  it('nulls the verified link and any pending claim', async () => {
    mockPrismaUser.update.mockResolvedValue({});
    await clearIrcNick(7);
    expect(mockPrismaUser.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        ircNick: null,
        pendingIrcNick: null,
        ircNickNonce: null,
        ircNickNonceExpiresAt: null
      }
    });
  });
});

// ─── verifyIrcNick ───────────────────────────────────────────────────────────

describe('verifyIrcNick', () => {
  it('promotes the claim to the verified ircNick on a matching, unexpired (nick, code)', async () => {
    mockPrismaUser.findFirst.mockResolvedValue({
      id: 7,
      ircNickNonceExpiresAt: new Date(Date.now() + 60_000)
    });
    mockPrismaUser.update.mockResolvedValue({});

    const result = await verifyIrcNick('Alice', 'ABCD2345');

    expect(result).toEqual({ verified: true });
    expect(mockPrismaUser.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        ircNick: 'Alice',
        pendingIrcNick: null,
        ircNickNonce: null,
        ircNickNonceExpiresAt: null
      }
    });
  });

  it('fails when no pending claim matches the (nick, code) pair', async () => {
    mockPrismaUser.findFirst.mockResolvedValue(null);
    const result = await verifyIrcNick('Alice', 'WRONGXXX');
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/no matching/i);
    expect(mockPrismaUser.update).not.toHaveBeenCalled();
  });

  it('fails (without promoting) when the code has expired', async () => {
    mockPrismaUser.findFirst.mockResolvedValue({
      id: 7,
      ircNickNonceExpiresAt: new Date(Date.now() - 1000)
    });
    const result = await verifyIrcNick('Alice', 'ABCD2345');
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/expired/i);
    expect(mockPrismaUser.update).not.toHaveBeenCalled();
  });

  it('loses the race when the nick was just verified by another account (P2002)', async () => {
    mockPrismaUser.findFirst.mockResolvedValue({
      id: 7,
      ircNickNonceExpiresAt: new Date(Date.now() + 60_000)
    });
    mockPrismaUser.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test'
      })
    );
    const result = await verifyIrcNick('Alice', 'ABCD2345');
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/another account/i);
  });
});
