/**
 * Invite lapse rule — the pure core of the invite lifecycle (#627, ADR-0041).
 *
 * One definition of "this invite can no longer be used", shared by the three
 * places that must agree on it: registration (refuse the key), `createInvite`
 * (free the address for a re-invite) and the sweep (mark it and refund). No DB
 * and no I/O; the Prisma where-fragments below are plain objects that restate
 * the same rule for the writes. Since #640 "is the address free" is a second,
 * stricter rule for cancelled invites: see `isAddressFree`.
 *
 * Three things here are deliberate and not obvious from the issue:
 *
 *  - A pending invite whose INVITER is disabled has lapsed. Staff disabling a
 *    member within an invite's three days is almost always a moderation act,
 *    and a disabled member should not keep bringing people in. It answers the
 *    key holder exactly as an ordinary lapse does, so the reply cannot reveal
 *    that the inviter was disabled. An inviter whose invite privileges staff
 *    revoked (`canInvite = false`, #636) is the same case, for the same reason.
 *  - `expired` and `cancelled` (#636) are stored statuses, but a `pending` row
 *    past `expires` has lapsed too. The sweep runs hourly, and the gates must
 *    not honour a key in the gap between expiry and the sweep reaching it.
 *  - The TTL is a constant, not configuration (ADR-0038 §4's rule: thresholds
 *    are code). It also decides when refunds happen, so it moves by review.
 */
import type { InviteStatus, Prisma } from '@prisma/client';
import { DAY_MS } from './inviteGrant';

/** How long a newly sent invite stays usable. */
export const INVITE_TTL_DAYS = 3;

export const inviteExpiresAt = (now: Date): Date =>
  new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);

export interface InviteLapseInput {
  status: InviteStatus;
  expires: Date;
  inviterDisabled: boolean;
  inviterCanInvite: boolean;
}

/**
 * The stored statuses of an invite that ended unused: it ran out, or it was
 * cancelled, by staff (#636) or withdrawn by its inviter (#640). Both have
 * lapsed and both were refunded when they left `pending`. A cancel answers the
 * key holder exactly as an expiry does, so it cannot confirm a moderation act.
 * They differ on when the address is free again: see `isAddressFree`.
 */
export const LAPSED_INVITE_STATUSES: readonly InviteStatus[] = [
  'expired',
  'cancelled'
];

/**
 * Whether an invite can no longer be used. An `accepted` invite has not
 * lapsed — it was used — so it never frees its address.
 */
export const isInviteLapsed = (
  invite: InviteLapseInput,
  now: Date
): boolean => {
  if (LAPSED_INVITE_STATUSES.includes(invite.status)) return true;
  if (invite.status !== 'pending') return false;
  return (
    invite.expires.getTime() <= now.getTime() ||
    invite.inviterDisabled ||
    !invite.inviterCanInvite
  );
};

/**
 * Whether a row's address can be invited again. Not the same question as
 * `isInviteLapsed`, which asks whether its KEY is still usable.
 *
 * A cancelled invite's key dies at once, but its address stays taken until the
 * invite's original `expires` (#640). A withdraw refunds, so without this a
 * member could send, withdraw and send again in a loop, mailing one address as
 * often as they liked at no cost. Holding the address for the lifetime the
 * first send already claimed keeps it to one invite email per address per
 * lifetime, as #627 had it. A typo is unaffected: the corrected address is a
 * different row.
 */
export const isAddressFree = (invite: InviteLapseInput, now: Date): boolean =>
  invite.status === 'cancelled'
    ? invite.expires.getTime() <= now.getTime()
    : isInviteLapsed(invite, now);

/**
 * The rows a re-invite may take over, as a where fragment: `isAddressFree` for
 * rows no longer `pending`. A lapsed `pending` row is expired first by the
 * caller, through the claim below, and then matches.
 */
export const reusableInviteWhere = (now: Date): Prisma.InviteWhereInput => ({
  OR: [{ status: 'expired' }, { status: 'cancelled', expires: { lte: now } }]
});

/**
 * `isInviteLapsed` restricted to rows still marked `pending`, as a where
 * fragment. This is the CLAIM predicate: moving a row out of it is what pays
 * the refund, so only one writer can ever win it.
 */
export const lapsedPendingInviteWhere = (
  now: Date
): Prisma.InviteWhereInput => ({
  status: 'pending',
  OR: [
    { expires: { lte: now } },
    { inviter: { disabled: true } },
    { inviter: { canInvite: false } }
  ]
});

/** The complement for pending rows: a key registration may still accept. */
export const livePendingInviteWhere = (now: Date): Prisma.InviteWhereInput => ({
  status: 'pending',
  expires: { gt: now },
  inviter: { disabled: false, canInvite: true }
});
