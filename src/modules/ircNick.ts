/**
 * IRC nick verification (ADR-0015) — challenge/nonce proof-of-control.
 *
 * A self-reported nick is a *Nick Claim*: it lives in `pendingIrcNick` + a
 * single-use `ircNickNonce`, reserves nothing, and credits nothing. The member
 * proves control by sending the code from that nick to the bridge bot; korin
 * relays `(nick, code)` to `verifyIrcNick`, which promotes the claim to the
 * *Verified IRC Link* (`User.ircNick`, unique). Because `ircNick` only ever holds
 * a verified value, the IRCScore scorer and the `by-irc-nick` lookup get their
 * gating for free — they already key on `ircNick`.
 *
 * Security boundary: the `(fromNick, code)` pairing. A leaked code is useless to
 * anyone who can't present it *as that nick* on IRC, which Ergo's
 * force-nick-equals-account enforces. Code confidentiality is hygiene, not the lock.
 */
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

/** Verification Code lifetime (ADR-0015). */
export const NONCE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Human-typeable alphabet — Crockford-style, ambiguous glyphs (I, L, O, 0, 1)
// removed so a member can read the code off one screen and type it into an IRC
// client without confusion. Strength is not load-bearing (the nick binding is),
// so a small modulo bias here is irrelevant.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** Generate an 8-char human-typeable Verification Code. */
export const generateVerificationCode = (length = CODE_LENGTH): string => {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
};

export interface NickClaimResult {
  /** The Verification Code the member presents on IRC. */
  code: string;
  expiresAt: Date;
  /** True when the member's account is already verified to this exact nick. */
  alreadyVerified: boolean;
}

/**
 * Open (or refresh) a Nick Claim for `userId` on `nick`. Mints a fresh code and
 * resets the expiry, invalidating any prior code. Does NOT touch the verified
 * `ircNick` — an existing Verified IRC Link stays active until the new claim is
 * proven. Throws 409 if the nick is already verified to a *different* account.
 */
export const claimIrcNick = async (
  userId: number,
  nick: string
): Promise<NickClaimResult> => {
  const holder = await prisma.user.findUnique({
    where: { ircNick: nick },
    select: { id: true }
  });
  if (holder && holder.id !== userId) {
    throw new AppError(
      409,
      'That IRC nick is already linked to another account'
    );
  }
  if (holder && holder.id === userId) {
    // Already this member's Verified IRC Link — nothing to prove.
    return { code: '', expiresAt: new Date(), alreadyVerified: true };
  }

  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await prisma.user.update({
    where: { id: userId },
    data: {
      pendingIrcNick: nick,
      ircNickNonce: code,
      ircNickNonceExpiresAt: expiresAt
    }
  });
  return { code, expiresAt, alreadyVerified: false };
};

/**
 * Clear both the Verified IRC Link and any pending Nick Claim for `userId`.
 */
export const clearIrcNick = async (userId: number): Promise<void> => {
  await prisma.user.update({
    where: { id: userId },
    data: {
      ircNick: null,
      pendingIrcNick: null,
      ircNickNonce: null,
      ircNickNonceExpiresAt: null
    }
  });
};

export interface VerifyResult {
  verified: boolean;
  /** Member-facing reason on failure — the bot relays this back over IRC. */
  reason?: string;
}

/**
 * Complete a Nick Verification from a relayed `(nick, code)` pair. Matches the
 * pending claim, checks expiry, and promotes it to the Verified IRC Link. The
 * `nick` MUST be the authenticated IRC sender (korin's responsibility) — this is
 * the binding that makes the code unstealable.
 */
export const verifyIrcNick = async (
  nick: string,
  code: string
): Promise<VerifyResult> => {
  const claim = await prisma.user.findFirst({
    where: { pendingIrcNick: nick, ircNickNonce: code },
    select: { id: true, ircNickNonceExpiresAt: true }
  });
  if (!claim) {
    return {
      verified: false,
      reason: 'No matching verification is pending for that nick'
    };
  }
  if (
    !claim.ircNickNonceExpiresAt ||
    claim.ircNickNonceExpiresAt < new Date()
  ) {
    return {
      verified: false,
      reason: 'Verification code has expired — request a new one'
    };
  }

  try {
    await prisma.user.update({
      where: { id: claim.id },
      data: {
        ircNick: nick,
        pendingIrcNick: null,
        ircNickNonce: null,
        ircNickNonceExpiresAt: null
      }
    });
  } catch (err) {
    // Unique violation on ircNick: the nick was verified by another account in
    // the race window. First to verify wins; this claim loses.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return {
        verified: false,
        reason: 'That nick was just linked to another account'
      };
    }
    throw err;
  }
  return { verified: true };
};
