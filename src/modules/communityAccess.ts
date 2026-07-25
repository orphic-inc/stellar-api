import { Prisma, RegistrationStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

/**
 * The community role union — every Axis-1 relation that makes a user part of a
 * community: `consumer ∪ contributor ∪ curator`. A composable
 * `Prisma.CommunityWhereInput` so the browse filter, the access gate below and
 * the member roster ask one question in one place (ADR-0030 §Decision 2,
 * ADR-0033 §Decision 1, #419).
 *
 * This is the definition of membership, not merely of access: `Consumer` is the
 * consumption identity, one role within the union rather than a synonym for
 * belonging (ADR-0033).
 *
 * `leaderId` is defensively redundant: ADR-0021 makes the leader a superset of
 * `curators`, so the arm only bites if a row drifts from that invariant.
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
    { curators: { some: { id: userId } } },
    { leaderId: userId }
  ]
});

/** The roles the union is built from, in the order a member's roles are reported. */
export const COMMUNITY_ROLES = [
  'consumer',
  'contributor',
  'curator',
  'leader'
] as const;

export type CommunityRole = (typeof COMMUNITY_ROLES)[number];

export interface CommunityMember {
  id: number;
  username: string;
  roles: CommunityRole[];
}

/**
 * The community's member roster: the same union as above, projected the other
 * way round — given a community, which users hold a role in it, and which
 * (ADR-0033 §Decision 4).
 *
 * `communityRoleUnion` cannot be reused literally here. It is a
 * `CommunityWhereInput` — it filters *communities* by a user — and the roster
 * needs the inverse: *users* for one community. The arms are the same four and
 * must stay the same four, which is what `COMMUNITY_ROLES` above and the
 * agreement test in communityAccess.spec.ts exist to enforce; a fifth arm added
 * to one and not the other is the drift ADR-0010 warns about.
 *
 * `leader` is reported alongside `curator` rather than instead of it: ADR-0021's
 * invariant makes the leader a curator, and a caller that wants "can this user
 * curate" should not have to know about the distinguished case.
 */
export const listCommunityMembers = async (
  communityId: number
): Promise<CommunityMember[]> => {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: {
      leader: { select: { id: true, username: true } },
      curators: { select: { id: true, username: true } },
      consumers: { select: { user: { select: { id: true, username: true } } } },
      contributors: {
        select: { user: { select: { id: true, username: true } } }
      }
    }
  });
  if (!community) return [];

  const members = new Map<number, CommunityMember>();
  const add = (
    user: { id: number; username: string },
    role: CommunityRole
  ): void => {
    const existing = members.get(user.id);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
      return;
    }
    members.set(user.id, {
      id: user.id,
      username: user.username,
      roles: [role]
    });
  };

  for (const { user } of community.consumers) add(user, 'consumer');
  for (const { user } of community.contributors) add(user, 'contributor');
  for (const curator of community.curators) add(curator, 'curator');
  // Normally additive — the invariant already put the leader in `curators`. If a
  // row drifted, `add` enters them anyway, because the union's `leaderId` arm
  // would still count them and the roster must agree with the union.
  if (community.leader) add(community.leader, 'leader');

  // Roles in COMMUNITY_ROLES order, members alphabetical — a roster is read by
  // people, and a stable order keeps the response diffable.
  for (const member of members.values()) {
    member.roles.sort(
      (a, b) => COMMUNITY_ROLES.indexOf(a) - COMMUNITY_ROLES.indexOf(b)
    );
  }
  return [...members.values()].sort(
    (a, b) => a.username.localeCompare(b.username) || a.id - b.id
  );
};

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
