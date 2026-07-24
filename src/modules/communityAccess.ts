import { Prisma, RegistrationStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

/**
 * The community role union — every Axis-1 relation that makes a user part of a
 * community: `consumer ∪ contributor ∪ staff`. A composable
 * `Prisma.CommunityWhereInput` so the browse filter and the access gate below
 * ask one question in one place (ADR-0030 §Decision 2, #419).
 *
 * `leaderId` is defensively redundant: ADR-0021 makes the leader a superset of
 * `staff` (setting it connects the staff row and upserts a Consumer), so the
 * arm only bites if a row drifts from that invariant.
 *
 * Deliberately omits `Community.announceVisibility`. That field routes
 * announcements and nothing else; access is governed by
 * `registrationStatus` plus this union, so a `PRIVATE` community registered
 * `open` stays readable by anyone (ADR-0015, Golden Rule 3). Reading it here
 * would convert a routing flag into an authorization gate.
 */
export const communityRoleUnion = (
  userId: number
): Prisma.CommunityWhereInput => ({
  OR: [
    { consumers: { some: { userId } } },
    { contributors: { some: { userId } } },
    { staff: { some: { id: userId } } },
    { leaderId: userId }
  ]
});

/**
 * Can this user reach this community's contents? `open || roleUnion`.
 *
 * Named for access, not membership (it was `isCommunityMember`): its call-sites
 * ask four different questions — read a community, read its health, list its
 * releases, edit a release in it — and the last is a write gate. A "member"
 * name would hide four distinct authorizations behind one predicate (ADR-0001,
 * ADR-0030 §Decision 2).
 *
 * `registrationStatus` comes from callers that have already loaded the
 * community, so the gate costs at most one extra query.
 */
export const hasCommunityAccess = async (
  communityId: number,
  userId: number,
  registrationStatus: RegistrationStatus
): Promise<boolean> => {
  if (registrationStatus === RegistrationStatus.open) return true;
  const match = await prisma.community.findFirst({
    where: { id: communityId, ...communityRoleUnion(userId) },
    select: { id: true }
  });
  return !!match;
};

/**
 * Load a community the user is allowed to reach, or throw the 404/403 the
 * route would have sent. The load-then-gate shape every module-side caller
 * needs, so the gate can't be forgotten between the two.
 */
export const assertCommunityAccess = async (
  communityId: number,
  userId: number
): Promise<{ registrationStatus: RegistrationStatus }> => {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { registrationStatus: true }
  });
  if (!community) throw new AppError(404, 'Community not found');

  const canAccess = await hasCommunityAccess(
    communityId,
    userId,
    community.registrationStatus
  );
  if (!canAccess) throw new AppError(403, 'Not a member of this community');

  return community;
};
