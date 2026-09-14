/**
 * Sending an invite (#627, ADR-0041). Moved out of `profile.ts`, which still
 * re-exports it, when re-invites made it part of the invite lifecycle.
 *
 * `email` is unique on `Invite`, so an address has at most one row. A lapsed row
 * (see `inviteExpiry.ts`) is reused in place rather than blocking the address
 * forever. If nobody has expired it yet, this call does — which refunds the
 * original inviter through the same claim the sweep uses, so the refund still
 * happens exactly once.
 */
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sanitizePlain } from '../lib/sanitize';
import { sendInviteEmail } from '../lib/mailer';
import { getLogger } from './logging';
import { inviteExpiresAt, isInviteLapsed } from './inviteExpiry';
import {
  expireLapsedInvite,
  notifyInviteExpired,
  type LapsedInvite
} from './inviteExpiryJob';

const log = getLogger('invite');

type RefusalReason = 'no_invites' | 'already_invited';

type CreateInviteResult =
  | { ok: true; inviteKey: string; emailSent: boolean }
  | { ok: false; reason: RefusalReason };

/** Thrown inside the transaction purely to roll it back with a reason. */
class InviteRefused extends Error {
  constructor(readonly reason: RefusalReason) {
    super(reason);
  }
}

const findInviteByEmail = (email: string) =>
  prisma.invite.findUnique({
    where: { email },
    select: {
      id: true,
      inviterId: true,
      email: true,
      status: true,
      expires: true,
      inviter: { select: { disabled: true } }
    }
  });

type ExistingInvite = NonNullable<
  Awaited<ReturnType<typeof findInviteByEmail>>
>;

/**
 * Write the invite and spend one, atomically. Returns the invite this call
 * expired on the way, if any, so the caller can notify its inviter once the
 * transaction has committed.
 *
 * The spend is a conditional decrement rather than trusting an earlier read: a
 * member racing two sends with one invite left gets one, not a negative
 * balance. Because it runs after any refund, a member re-inviting their own
 * lapsed address is never refused for a balance the refund just restored.
 */
const writeInvite = (
  inviterId: number,
  email: string,
  existing: ExistingInvite | null,
  fields: Omit<Prisma.InviteUncheckedCreateInput, 'email' | 'inviterId'>,
  now: Date
): Promise<LapsedInvite | null> =>
  prisma.$transaction(async (tx) => {
    let expired: LapsedInvite | null = null;

    if (existing) {
      const lapsed = {
        id: existing.id,
        inviterId: existing.inviterId,
        email: existing.email
      };
      const actor = { actorId: inviterId, by: 'createInvite' };
      if (await expireLapsedInvite(tx, lapsed, now, actor)) expired = lapsed;

      // Reuse only a row that is expired NOW. A concurrent re-invite that got
      // here first has already flipped it back to pending.
      const { count } = await tx.invite.updateMany({
        where: { id: existing.id, status: 'expired' },
        data: { ...fields, inviterId, status: 'pending' }
      });
      if (count === 0) throw new InviteRefused('already_invited');
    } else {
      await tx.invite.create({ data: { ...fields, inviterId, email } });
    }

    const spent = await tx.user.updateMany({
      where: { id: inviterId, inviteCount: { gt: 0 } },
      data: { inviteCount: { decrement: 1 } }
    });
    if (spent.count === 0) throw new InviteRefused('no_invites');

    return expired;
  });

/** An address is free to invite when it has no row, or its row has lapsed. */
const isAddressTaken = (existing: ExistingInvite | null, now: Date): boolean =>
  existing !== null &&
  !isInviteLapsed(
    {
      status: existing.status,
      expires: existing.expires,
      inviterDisabled: existing.inviter.disabled
    },
    now
  );

/**
 * Map a failed write to a refusal, or `null` for an error that is not one.
 * Two first-time sends to the same address: the loser hits `email @unique`.
 */
const refusalFor = (err: unknown): RefusalReason | null => {
  if (err instanceof InviteRefused) return err.reason;
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002'
  ) {
    return 'already_invited';
  }
  return null;
};

export const createInvite = async (
  inviterId: number,
  email: string,
  reason: string
): Promise<CreateInviteResult> => {
  const normalizedEmail = sanitizePlain(email).trim().toLowerCase();
  const now = new Date();

  const existing = await findInviteByEmail(normalizedEmail);
  if (isAddressTaken(existing, now)) {
    return { ok: false, reason: 'already_invited' };
  }

  const inviteKey = crypto.randomBytes(20).toString('hex');
  const fields = {
    inviteKey,
    expires: inviteExpiresAt(now),
    reason: sanitizePlain(reason).trim(),
    createdAt: now
  };

  let expired: LapsedInvite | null;
  try {
    expired = await writeInvite(
      inviterId,
      normalizedEmail,
      existing,
      fields,
      now
    );
  } catch (err) {
    const refusal = refusalFor(err);
    if (refusal === null) throw err;
    return { ok: false, reason: refusal };
  }

  // A member re-inviting their own lapsed address needs no PM about it.
  if (expired && expired.inviterId !== inviterId) {
    await notifyInviteExpired(expired);
  }

  let emailSent = false;
  try {
    emailSent = await sendInviteEmail(normalizedEmail, inviteKey);
  } catch (err) {
    log.error('Failed to send invite email', { to: normalizedEmail, err });
  }

  return { ok: true, inviteKey, emailSent };
};
