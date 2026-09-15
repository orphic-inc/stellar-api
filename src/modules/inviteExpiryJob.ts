/**
 * Invite expiry sweep (#627, ADR-0041) — marks lapsed invites `expired` and
 * returns each one to its inviter. The lapse rule itself lives in the pure
 * `inviteExpiry.ts`; this module owns the claim and the refund.
 *
 * Three things here are deliberate and not obvious from the issue:
 *
 *  - The refund belongs to the `pending → expired` TRANSITION, not to this job.
 *    `expireLapsedInvite` claims it with a conditional `updateMany` and refunds
 *    only when it moved the row, so the sweep and a re-invite (`createInvite`)
 *    can both expire invites without either ever refunding twice.
 *  - There is no mode switch, unlike the inactivity and invite-grant sweeps.
 *    This job only returns invites that were actually spent, so there is no
 *    blast radius to bound. And the gates already refuse lapsed keys, so a
 *    switched-off sweep would leave invites dead AND unrefunded — worse than
 *    never expiring them.
 *  - One transaction per invite, each caught on its own. A bad row is logged
 *    and skipped; it cannot abort the cycle for every invite behind it.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { getLogger } from './logging';
import { inviteExpiry as inviteExpiryConfig } from './config';
import { resolveSystemActorId } from './rankProgressionJob';
import { sendSystemMessage } from './pm';
import { lapsedPendingInviteWhere } from './inviteExpiry';

const log = getLogger('inviteExpiryJob');

const STARTUP_DELAY_MS = 120_000;
const BATCH_SIZE = 500;

export interface LapsedInvite {
  id: number;
  inviterId: number;
  email: string;
}

/**
 * Claim one lapsed invite and refund it, inside the caller's transaction.
 *
 * Returns whether THIS call made the transition. `false` means the row was no
 * longer a lapsed pending invite at write time — already expired by someone
 * else, accepted, or still live — and nothing was written.
 *
 * The refund is a plain increment with no cap predicate: it returns an invite
 * that was already the member's, and the cap bounds accrual, not holdings
 * (ADR-0041). A disabled inviter is refunded too; the balance is inert until
 * staff re-enable them.
 */
export const expireLapsedInvite = async (
  tx: Prisma.TransactionClient,
  invite: LapsedInvite,
  now: Date,
  actor: { actorId: number; by: string }
): Promise<boolean> => {
  const { count } = await tx.invite.updateMany({
    where: { id: invite.id, ...lapsedPendingInviteWhere(now) },
    data: { status: 'expired' }
  });
  if (count === 0) return false;

  await tx.user.update({
    where: { id: invite.inviterId },
    data: { inviteCount: { increment: 1 } }
  });
  await audit(tx, actor.actorId, 'invite.expired', 'Invite', invite.id, {
    by: actor.by,
    inviterId: invite.inviterId,
    email: invite.email,
    refunded: true
  });
  return true;
};

const EXPIRED_SUBJECT = 'Your invite expired and has been returned';
const expiredBody = (email: string) =>
  `Your invite to ${email} expired before it was used, so it has been returned to you. You can invite that address again.`;

/**
 * Tell the inviter. Call only AFTER the transaction commits, so a failed PM can
 * never roll back a refund. A disabled inviter is refused by
 * `sendSystemMessage` itself, which is the intended outcome.
 *
 * An inviter whose invite privileges are revoked (#636) gets no PM either. Their
 * pending invites lapse because of the revoke, not because time ran out, and
 * "you can invite that address again" would be false. Staff tell them about the
 * revoke itself. Read at send time, so a restore before the PM is honoured.
 */
export const notifyInviteExpired = async (invite: LapsedInvite) => {
  try {
    const inviter = await prisma.user.findUnique({
      where: { id: invite.inviterId },
      select: { canInvite: true }
    });
    if (inviter?.canInvite === false) return;
    await sendSystemMessage(
      invite.inviterId,
      EXPIRED_SUBJECT,
      expiredBody(invite.email)
    );
  } catch (err) {
    log.error('Invite expiry PM failed', { inviteId: invite.id, err });
  }
};

interface Tally {
  expired: number;
  failed: number;
}

/**
 * Keyed on `id > cursor` rather than a Prisma cursor: claimed rows leave the
 * where set as the cycle runs, and a bare `take` would re-read the same first
 * batch whenever a row in it failed.
 */
const loadBatch = (after: number, now: Date): Promise<LapsedInvite[]> =>
  prisma.invite.findMany({
    where: { ...lapsedPendingInviteWhere(now), id: { gt: after } },
    select: { id: true, inviterId: true, email: true },
    orderBy: { id: 'asc' },
    take: BATCH_SIZE
  });

const expireOne = async (
  invite: LapsedInvite,
  now: Date,
  systemActorId: number,
  tally: Tally
): Promise<void> => {
  try {
    const claimed = await prisma.$transaction((tx) =>
      expireLapsedInvite(tx, invite, now, {
        actorId: systemActorId,
        by: 'inviteExpiryJob'
      })
    );
    if (!claimed) return;
    tally.expired += 1;
    await notifyInviteExpired(invite);
  } catch (err) {
    tally.failed += 1;
    log.error('Invite expiry failed', { inviteId: invite.id, err });
  }
};

export const runInviteExpiryCycle = async (
  now: Date = new Date()
): Promise<Tally> => {
  const tally: Tally = { expired: 0, failed: 0 };

  const systemActorId = await resolveSystemActorId();
  if (systemActorId === null) {
    log.warn('No SysOp actor — invite expiry sweep skipped');
    return tally;
  }

  let after = 0;
  for (;;) {
    const batch = await loadBatch(after, now);
    for (const invite of batch) {
      await expireOne(invite, now, systemActorId, tally);
    }
    if (batch.length < BATCH_SIZE) break;
    after = batch[batch.length - 1].id;
  }

  if (tally.expired > 0 || tally.failed > 0) {
    log.info('Invite expiry cycle complete', tally);
  }
  return tally;
};

export const startInviteExpiryJob = (): void => {
  const run = () =>
    void runInviteExpiryCycle().catch((err) =>
      log.error('Invite expiry cycle failed', { err })
    );

  const outer = setTimeout(() => {
    run();
    setInterval(run, inviteExpiryConfig.intervalMs).unref();
  }, STARTUP_DELAY_MS);
  outer.unref();

  log.info('Invite expiry job scheduled', {
    intervalMs: inviteExpiryConfig.intervalMs
  });
};
