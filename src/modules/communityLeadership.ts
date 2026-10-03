import {
  LeadershipEventKind,
  NotificationType,
  Prisma,
  RegistrationStatus
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { audit } from '../lib/audit';
import { emitNotifications } from '../lib/notifications';
import { hasCommunityAccess } from './communityAccess';

/**
 * Community leadership: the leader rules a staff `PUT /communities/:id` applies
 * (ADR-0021, ADR-0033, #891, #892), and the handoff (#896, ADR-0053 §3–8).
 *
 * A leader hands off leadership by offer, and the named successor accepts or
 * declines. One offer per community, stored on the row as `leaderOfferToId` +
 * `leaderOfferedAt`; a new offer replaces the old, and the audit log holds the
 * history.
 */

/**
 * The curator write a PUT /:id makes, so the leader stays a curator
 * (ADR-0021, narrowed by ADR-0033).
 *
 * - `curatorIds` replaces the whole set, so the leader is folded back in: the
 *   body's `leaderId` when sent, else the current leader (#891). A cleared
 *   leader is not folded, so the list stands as given (#892).
 * - Otherwise a new leader is connected, leaving the outgoing one a curator (a
 *   handoff), and a cleared leader is disconnected: a clear with no successor
 *   is a demotion (#892, ADR-0033 §5).
 */
export const leaderCuratorWrite = (
  curatorIds: number[] | undefined,
  leaderId: number | null | undefined,
  previousLeaderId: number | null
) => {
  if (curatorIds !== undefined) {
    const kept = leaderId !== undefined ? leaderId : previousLeaderId;
    const ids =
      kept !== null ? [...new Set([...curatorIds, kept])] : curatorIds;
    return { set: ids.map((cid) => ({ id: cid })) };
  }
  if (leaderId === undefined) return undefined;
  if (leaderId !== null) return { connect: { id: leaderId } };
  return previousLeaderId !== null
    ? { disconnect: { id: previousLeaderId } }
    : undefined;
};

/**
 * Invite-only and closed communities need a leader, as at create. Checked on
 * the state a PUT /:id would leave, and only when it changes either side, so
 * an unrelated edit to an older row is not refused (#892).
 */
export const leavesLeaderless = (
  registrationStatus: RegistrationStatus | undefined,
  leaderId: number | null | undefined,
  existing: { registrationStatus: RegistrationStatus; leaderId: number | null }
) => {
  if (registrationStatus === undefined && leaderId === undefined) return false;
  const status = registrationStatus ?? existing.registrationStatus;
  const leader = leaderId !== undefined ? leaderId : existing.leaderId;
  return status !== RegistrationStatus.open && leader === null;
};

/** How long an offer stays open (ADR-0053 §5). */
export const LEADER_OFFER_TTL_DAYS = 7;

const TTL_MS = LEADER_OFFER_TTL_DAYS * 24 * 60 * 60 * 1000;

/** The write that ends an offer: withdraw, decline, accept, a staff reassign. */
export const LEADER_OFFER_CLEARED = {
  leaderOfferToId: null,
  leaderOfferedAt: null
} as const;

/**
 * The community, while its stored offer is live. Lapse is lazy (ADR-0053 §5):
 * no job clears a stale offer, so every read and every claim goes through
 * this, and a stored offer it rejects is treated as absent. An offer lapses when:
 *
 * - it is more than `LEADER_OFFER_TTL_DAYS` old;
 * - the successor is no longer an enabled curator of this community;
 * - the leader who made it is disabled.
 *
 * The fourth rule, "the leader who made it is no longer the leader", needs no
 * clause: every write that moves `leaderId` clears the offer (an accept here, a
 * staff `PUT /communities/:id`), so a stored offer is always the current
 * leader's.
 */
export const liveLeaderOfferWhere = (
  communityId: number,
  now: Date = new Date()
): Prisma.CommunityWhereInput => ({
  id: communityId,
  leaderOfferedAt: { gt: new Date(now.getTime() - TTL_MS) },
  leader: { is: { disabled: false } },
  leaderOfferTo: {
    is: { disabled: false, communitiesCurated: { some: { id: communityId } } }
  }
});

export type LeaderOffer = {
  to: { id: number; username: string };
  offeredAt: Date;
};

const readLiveLeaderOffer = async (
  communityId: number
): Promise<LeaderOffer | null> => {
  const row = await prisma.community.findFirst({
    where: liveLeaderOfferWhere(communityId),
    select: {
      leaderOfferedAt: true,
      leaderOfferTo: { select: { id: true, username: true } }
    }
  });
  if (!row?.leaderOfferTo || !row.leaderOfferedAt) return null;
  return { to: row.leaderOfferTo, offeredAt: row.leaderOfferedAt };
};

/**
 * `GET /communities/:id`'s `leaderOffer` (ADR-0053 §8): the live offer for the
 * leader, the named successor, or staff; null for everyone else, who see the
 * outcome when `leaderId` changes rather than the leader's intent beforehand.
 */
export const leaderOfferFor = async (
  community: { id: number; leaderId: number | null },
  viewerId: number,
  isStaff: boolean
): Promise<LeaderOffer | null> => {
  const offer = await readLiveLeaderOffer(community.id);
  if (!offer) return null;
  const isParty = community.leaderId === viewerId || offer.to.id === viewerId;
  return isStaff || isParty ? offer : null;
};

/**
 * A missing or hidden community answers exactly as `GET /:id` does (#771).
 * `staffRead` admits staff to the administrative record (ADR-0055); the
 * handoff writes never pass it.
 */
const loadReadable = async (
  communityId: number,
  callerId: number,
  staffRead = false
) => {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { id: true, leaderId: true, registrationStatus: true }
  });
  if (!community) throw new AppError(404, 'Community not found');
  if (
    !staffRead &&
    !(await hasCommunityAccess(
      communityId,
      callerId,
      community.registrationStatus
    ))
  ) {
    throw new AppError(403, 'Not a member of this community');
  }
  return community;
};

const loadAsLeader = async (communityId: number, callerId: number) => {
  const community = await loadReadable(communityId, callerId);
  if (community.leaderId !== callerId)
    throw new AppError(403, 'Only the community leader can do this');
  return community;
};

/**
 * The leader offers leadership to one of the community's enabled curators,
 * replacing any pending offer (ADR-0053 §4). The write is the check: it lands
 * only while the caller leads and the target is an enabled curator.
 */
export const offerLeadership = async (
  communityId: number,
  callerId: number,
  userId: number
): Promise<void> => {
  await loadAsLeader(communityId, callerId);
  if (userId === callerId)
    throw new AppError(409, 'You are already the community leader');

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.community.updateMany({
      where: {
        id: communityId,
        leaderId: callerId,
        curators: { some: { id: userId, disabled: false } }
      },
      data: { leaderOfferToId: userId, leaderOfferedAt: new Date() }
    });
    if (count === 0)
      throw new AppError(
        409,
        'Leadership can be offered only to a current curator'
      );
    await audit(
      tx,
      callerId,
      'community.leader.offer',
      'community',
      communityId,
      {
        userId
      }
    );
    await emitNotifications(tx, {
      userIds: [userId],
      type: NotificationType.community_leader_offered,
      actorId: callerId,
      page: 'communities',
      pageId: communityId
    });
  });
};

/**
 * The leader withdraws a pending offer. Idempotent: with no live offer there is
 * nothing to withdraw, and nothing is audited.
 */
export const withdrawLeaderOffer = async (
  communityId: number,
  callerId: number
): Promise<void> => {
  await loadAsLeader(communityId, callerId);
  const offer = await readLiveLeaderOffer(communityId);
  if (!offer) return;

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.community.updateMany({
      where: {
        ...liveLeaderOfferWhere(communityId),
        leaderId: callerId,
        leaderOfferToId: offer.to.id
      },
      data: LEADER_OFFER_CLEARED
    });
    if (count === 0) return;
    await audit(
      tx,
      callerId,
      'community.leader.withdraw',
      'community',
      communityId,
      { userId: offer.to.id }
    );
  });
};

const NO_OFFER = 'No pending leadership offer to you';

/**
 * The named successor accepts or declines. Accept moves `leaderId` and ends the
 * offer in one conditional write, re-checking every lapse rule and that the
 * leader is still the one read, so a concurrent change is never overwritten.
 * The outgoing leader stays a curator: a handoff keeps the role (#892).
 *
 * Anyone but the successor gets the same `404` as a missing offer, so a curator
 * cannot learn that the leader made one (ADR-0053 §8).
 */
export const answerLeaderOffer = async (
  communityId: number,
  callerId: number,
  accept: boolean
): Promise<void> => {
  await loadReadable(communityId, callerId);
  const offerToCaller = {
    ...liveLeaderOfferWhere(communityId),
    leaderOfferToId: callerId
  };
  const offered = await prisma.community.findFirst({
    where: offerToCaller,
    select: { leaderId: true }
  });
  const outgoingId = offered?.leaderId;
  if (!outgoingId) throw new AppError(404, NO_OFFER);

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.community.updateMany({
      where: { ...offerToCaller, leaderId: outgoingId },
      data: accept
        ? { leaderId: callerId, ...LEADER_OFFER_CLEARED }
        : LEADER_OFFER_CLEARED
    });
    if (count === 0) throw new AppError(404, NO_OFFER);
    await recordAnswer(tx, communityId, callerId, outgoingId, accept);
  });
};

const recordAnswer = async (
  tx: Prisma.TransactionClient,
  communityId: number,
  callerId: number,
  outgoingId: number,
  accept: boolean
) => {
  const action = accept
    ? 'community.leader.accept'
    : 'community.leader.decline';
  await audit(tx, callerId, action, 'community', communityId, {
    leaderId: outgoingId
  });
  if (accept) {
    // The leadership log's row (ADR-0054). Its ids cannot dangle: the claim
    // above just matched this community, and users are never deleted.
    await tx.communityLeadershipEvent.create({
      data: {
        communityId,
        kind: LeadershipEventKind.handed_off,
        fromUserId: outgoingId,
        toUserId: callerId,
        actorId: callerId
      }
    });
    await audit(
      tx,
      callerId,
      'community.leader.set',
      'community',
      communityId,
      {
        leaderId: callerId,
        previousLeaderId: outgoingId
      }
    );
  }
  await emitNotifications(tx, {
    userIds: [outgoingId],
    type: accept
      ? NotificationType.community_leader_accepted
      : NotificationType.community_leader_declined,
    actorId: callerId,
    page: 'communities',
    pageId: communityId
  });
};

/**
 * What a staff `PUT /communities/:id` writes beside the leader, when it
 * changes the leader: it ends any pending handoff (ADR-0053 §5, #896) and logs
 * the change (ADR-0054, #897). An unchanged leader writes neither, so a form
 * that resends the whole community neither cancels an offer nor logs a change.
 */
export const leaderChangeWrite = (
  leaderId: number | null | undefined,
  previousLeaderId: number | null,
  actorId: number
) => {
  if (leaderId === undefined || leaderId === previousLeaderId) return {};
  return {
    ...LEADER_OFFER_CLEARED,
    leadershipEvents: {
      create: {
        kind:
          leaderId === null
            ? LeadershipEventKind.cleared
            : LeadershipEventKind.assigned,
        fromUserId: previousLeaderId,
        toUserId: leaderId,
        actorId
      }
    }
  };
};

/**
 * What a community create writes for its leader, if it names one: the pointer,
 * and the leadership log's first row (ADR-0054).
 */
export const leaderCreateWrite = (
  leaderId: number | undefined,
  actorId: number
) =>
  leaderId === undefined
    ? {}
    : {
        leaderId,
        leadershipEvents: {
          create: {
            kind: LeadershipEventKind.founded,
            toUserId: leaderId,
            actorId
          }
        }
      };

const userRef = { select: { id: true, username: true } } as const;

/**
 * A community's leadership log, newest first (ADR-0054). Anyone who can read
 * the community reads it, answering as `GET /:id` does (#771). `actor` names a
 * staff member on most kinds, so only staff are sent it (ADR-0054 §5).
 */
export const listLeadershipLog = async (
  communityId: number,
  viewerId: number,
  isStaff: boolean,
  page: { skip: number; limit: number }
) => {
  // Part of the administrative record, which staff read everywhere (ADR-0055).
  await loadReadable(communityId, viewerId, isStaff);
  const where = { communityId };
  const [rows, total] = await Promise.all([
    prisma.communityLeadershipEvent.findMany({
      where,
      select: {
        id: true,
        kind: true,
        at: true,
        from: userRef,
        to: userRef,
        actor: userRef
      },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      skip: page.skip,
      take: page.limit
    }),
    prisma.communityLeadershipEvent.count({ where })
  ]);
  const data = rows.map((row) => ({
    ...row,
    actor: isStaff ? row.actor : null
  }));
  return { data, total };
};
