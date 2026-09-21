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
import { Prisma, RatioPolicyStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sanitizePlain } from '../lib/sanitize';
import { sendInviteEmail } from '../lib/mailer';
import { getLogger } from './logging';
import type { PageParams } from '../lib/pagination';
import {
  inviteExpiresAt,
  isAddressFree,
  reusableInviteWhere,
  livePendingInviteWhere
} from './inviteExpiry';
import {
  expireLapsedInvite,
  notifyInviteExpired,
  type LapsedInvite
} from './inviteExpiryJob';
import {
  firstInviteRefusal,
  isOnRatioWatch,
  type InviteGateInput,
  type InviteGateRefusal
} from './inviteGates';
import { computeStanding } from './standing';
import { DAY_MS } from './inviteGrant';
import { getRatioStats } from './ratio';
import { getSettings, isSiteFull } from './settings';

const log = getLogger('invite');

type RefusalReason = InviteGateRefusal | 'already_invited';

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
      inviter: { select: { disabled: true, canInvite: true } }
    }
  });

type ExistingInvite = NonNullable<
  Awaited<ReturnType<typeof findInviteByEmail>>
>;

/**
 * The spend's claim on the inviter: the gates a staff decision can close, plus
 * the balance unless the sender is unlimited. Exported so a database test can
 * hold the claim on its own, apart from the pre-check in `createInvite` that
 * would otherwise hide it.
 */
export const inviteSpendWhere = (unlimited: boolean) =>
  ({
    ...(unlimited ? {} : { inviteCount: { gt: 0 } }),
    canInvite: true,
    canDownload: true
  }) satisfies Prisma.UserWhereInput;

/** An invite this send expired on the way, and whether that returned one. */
export type ExpiredInvite = LapsedInvite & { refunded: boolean };

/**
 * Load one member's state and answer the send gates (#637, ADR-0043).
 *
 * Standing, ratio watch, registration status and capacity are read here and
 * not in the spend: none is a staff decision that must land atomically, and a
 * member whose ratio or warnings change mid-send gains nothing worth a lock
 * (the ADR-0040 §3 argument). A member who sends in the instant before an
 * operator closes registration gains a three-day invite that lapses and
 * refunds, so a closure is a courtesy here too (#673); `registerUser` is the
 * exact gate. The ratio is computed only for a member whose row says `WATCH`.
 *
 * Settings are read ONCE and `maxUsers` handed to `isSiteFull`, which would
 * otherwise load them again. `getSettings` is an upsert, so the careless
 * version doubles a write on every eligibility poll.
 */
export const getInviteRefusal = async (
  userId: number,
  unlimited: boolean,
  now: Date = new Date()
): Promise<InviteGateRefusal | null> => {
  const settings = await getSettings();
  const [user, policy, siteFull] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        canInvite: true,
        canDownload: true,
        inviteCount: true,
        banDate: true,
        dateRegistered: true,
        warnings: { select: { expiresAt: true } }
      }
    }),
    prisma.ratioPolicyState.findUnique({
      where: { userId },
      select: { status: true }
    }),
    isSiteFull(settings.maxUsers)
  ]);
  const status = policy?.status ?? null;
  const meetsRequirement =
    status === RatioPolicyStatus.WATCH
      ? (await getRatioStats(userId)).meetsRequirement
      : true;

  const input: InviteGateInput = {
    canInvite: user.canInvite,
    canDownload: user.canDownload,
    standing: computeStanding({
      warnings: user.warnings,
      banned: user.banDate !== null,
      accountAgeDays: (now.getTime() - user.dateRegistered.getTime()) / DAY_MS,
      now
    }),
    onRatioWatch: isOnRatioWatch(status, meetsRequirement),
    registrationClosed: settings.registrationStatus === 'closed',
    siteFull,
    balance: user.inviteCount,
    unlimited
  };
  return firstInviteRefusal(input);
};

/**
 * Write the invite and spend one, atomically. Returns the invite this call
 * expired on the way, if any, so the caller can notify its inviter once the
 * transaction has committed.
 *
 * The spend is a conditional decrement rather than trusting an earlier read: a
 * member racing two sends with one invite left gets one, not a negative
 * balance. Because it runs after any refund, a member re-inviting their own
 * lapsed address is never refused for a balance the refund just restored.
 *
 * `canInvite` (#636) and `canDownload` (#637) are in the same predicate, so a
 * staff decision landing mid-send refuses the write rather than racing it. Only
 * when the spend misses do we read which part failed, in the gates' order.
 *
 * An unlimited sender (ADR-0043 §5) still takes the claim, decrementing by
 * zero, so those two gates hold for them too; the row records `spent: false`.
 */
const writeInvite = (
  inviterId: number,
  email: string,
  existing: ExistingInvite | null,
  fields: Omit<Prisma.InviteUncheckedCreateInput, 'email' | 'inviterId'>,
  now: Date
): Promise<ExpiredInvite | null> =>
  prisma.$transaction(async (tx) => {
    let expired: ExpiredInvite | null = null;
    // Read off the row being written, so the flag and the spend cannot disagree.
    const unlimited = fields.spent === false;

    if (existing) {
      const lapsed = {
        id: existing.id,
        inviterId: existing.inviterId,
        email: existing.email
      };
      const actor = { actorId: inviterId, by: 'createInvite' };
      const claim = await expireLapsedInvite(tx, lapsed, now, actor);
      if (claim) expired = { ...lapsed, refunded: claim.refunded };

      // Reuse only a row whose address is free NOW. A concurrent re-invite
      // that got here first has already flipped it back to pending, and a
      // cancelled row holds its address until its original expiry (#640).
      const { count } = await tx.invite.updateMany({
        where: { id: existing.id, ...reusableInviteWhere(now) },
        data: { ...fields, inviterId, status: 'pending' }
      });
      if (count === 0) throw new InviteRefused('already_invited');
    } else {
      await tx.invite.create({ data: { ...fields, inviterId, email } });
    }

    const spent = await tx.user.updateMany({
      where: { id: inviterId, ...inviteSpendWhere(unlimited) },
      data: { inviteCount: { decrement: unlimited ? 0 : 1 } }
    });
    if (spent.count === 0) {
      const inviter = await tx.user.findUnique({
        where: { id: inviterId },
        select: { canInvite: true, canDownload: true }
      });
      throw new InviteRefused(
        inviter?.canInvite === false
          ? 'invites_revoked'
          : inviter?.canDownload === false
            ? 'downloads_disabled'
            : 'no_invites'
      );
    }

    return expired;
  });

/** An address is free to invite when it has no row, or its row frees it. */
const isAddressTaken = (existing: ExistingInvite | null, now: Date): boolean =>
  existing !== null &&
  !isAddressFree(
    {
      status: existing.status,
      expires: existing.expires,
      inviterDisabled: existing.inviter.disabled,
      inviterCanInvite: existing.inviter.canInvite
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

/**
 * Everything that refuses before the write, so nothing is spent: the send gates
 * first, then the address. A member who cannot send at all is told why, not
 * that the address is taken.
 *
 * Except an empty balance the write itself refills. Re-inviting your own lapsed
 * invite that the sweep has not reached refunds you inside the same
 * transaction, before the spend (ADR-0041), so it pays for itself. The spend
 * predicate still has the last word on the balance.
 */
const refuseBeforeWrite = async (
  inviterId: number,
  existing: ExistingInvite | null,
  unlimited: boolean,
  now: Date
): Promise<RefusalReason | null> => {
  const taken = isAddressTaken(existing, now);
  const refusal = await getInviteRefusal(inviterId, unlimited, now);
  const refundsSelf =
    !taken &&
    existing?.inviterId === inviterId &&
    existing.status === 'pending';
  if (refusal && !(refusal === 'no_invites' && refundsSelf)) return refusal;
  return taken ? 'already_invited' : null;
};

/**
 * Send an invite. `unlimited` is the caller's `invites_unlimited`, resolved by
 * the route: this module never reads permissions.
 */
export const createInvite = async (
  inviterId: number,
  email: string,
  reason: string,
  { unlimited = false }: { unlimited?: boolean } = {}
): Promise<CreateInviteResult> => {
  const normalizedEmail = sanitizePlain(email).trim().toLowerCase();
  const now = new Date();

  const existing = await findInviteByEmail(normalizedEmail);
  const refused = await refuseBeforeWrite(inviterId, existing, unlimited, now);
  if (refused) return { ok: false, reason: refused };

  const inviteKey = crypto.randomBytes(20).toString('hex');
  const fields = {
    inviteKey,
    expires: inviteExpiresAt(now),
    reason: sanitizePlain(reason).trim(),
    createdAt: now,
    spent: !unlimited
  };

  let expired: ExpiredInvite | null;
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

/**
 * A member's own invites that can still be used (#640), soonest to lapse first.
 *
 * Live pending only, by the same predicate registration accepts on, so the
 * list never offers an invite the gates already refuse. Not a history: a
 * re-invite reuses the row and rewrites `inviterId`, so a past invite would
 * silently move to another member's list.
 */
export const listOwnPendingInvites = async (
  inviterId: number,
  pg: PageParams,
  now: Date = new Date()
) => {
  const where = { ...livePendingInviteWhere(now), inviterId };
  const [rows, total] = await Promise.all([
    prisma.invite.findMany({
      where,
      select: {
        id: true,
        email: true,
        reason: true,
        createdAt: true,
        expires: true
      },
      orderBy: [{ expires: 'asc' }, { id: 'asc' }],
      skip: pg.skip,
      take: pg.limit
    }),
    prisma.invite.count({ where })
  ]);
  return { rows, total };
};
