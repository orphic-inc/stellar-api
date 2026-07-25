/**
 * Unit tests for the shared community access predicate (#419, ADR-0030 slice 3).
 */

const mockPrismaCommunity = { findFirst: jest.fn(), findUnique: jest.fn() };

jest.mock('../lib/prisma', () => ({
  prisma: { community: mockPrismaCommunity }
}));

import { RegistrationStatus } from '@prisma/client';
import {
  COMMUNITY_ROLES,
  communityRoleUnion,
  hasCommunityAccess,
  listCommunityMembers
} from './communityAccess';

describe('communityRoleUnion', () => {
  it('unions every Axis-1 relation that makes a user part of a community', () => {
    expect(communityRoleUnion(7)).toEqual({
      OR: [
        { consumers: { some: { userId: 7 } } },
        { contributors: { some: { userId: 7 } } },
        { curators: { some: { id: 7 } } },
        { leaderId: 7 }
      ]
    });
  });

  // The browse composition (`OR: [ open, roleUnion ]`) is asserted where it is
  // actually issued: against the route in communities.spec.ts, and against a
  // real DB in integration/communityAccess.integration.ts. Rebuilding the
  // literal here would assert only itself.

  it('carries no visibility arm — announce routing never gates access', () => {
    // Guards ADR-0030's hard constraint: `announceVisibility` must never reach
    // this fragment. Asserted structurally so adding an arm fails here.
    expect(Object.keys(communityRoleUnion(7))).toEqual(['OR']);
    const arms = communityRoleUnion(7).OR as Array<Record<string, unknown>>;
    expect(arms.flatMap((arm) => Object.keys(arm))).toEqual([
      'consumers',
      'contributors',
      'curators',
      'leaderId'
    ]);
  });
});

describe('listCommunityMembers', () => {
  const community = {
    leader: { id: 1, username: 'ada' },
    curators: [
      { id: 1, username: 'ada' },
      { id: 2, username: 'grace' }
    ],
    consumers: [{ user: { id: 3, username: 'bob' } }],
    contributors: [{ user: { id: 4, username: 'carol' } }]
  };

  it('reports every role-holder, including one who holds a single role', async () => {
    mockPrismaCommunity.findUnique.mockResolvedValueOnce(community);

    // The point of ADR-0033: a curator with no Consumer row is a member.
    // Alphabetical by username, roles in COMMUNITY_ROLES order.
    await expect(listCommunityMembers(1)).resolves.toEqual([
      { id: 1, username: 'ada', roles: ['curator', 'leader'] },
      { id: 3, username: 'bob', roles: ['consumer'] },
      { id: 4, username: 'carol', roles: ['contributor'] },
      { id: 2, username: 'grace', roles: ['curator'] }
    ]);
  });

  it('agrees with communityRoleUnion on which relations confer membership', () => {
    // The roster projects the union the other way round and cannot reuse it
    // literally, so this is the guard against the two drifting: a fifth arm
    // added to one and not the other fails here (ADR-0010).
    const arms = communityRoleUnion(7).OR as Array<Record<string, unknown>>;
    const unionRelations = arms.flatMap((arm) => Object.keys(arm));
    const rosterRelations = COMMUNITY_ROLES.map((role) =>
      role === 'leader' ? 'leaderId' : `${role}s`
    );
    expect(rosterRelations).toEqual(unionRelations);
  });

  it('still lists a leader whose curator row drifted away', async () => {
    // The union's leaderId arm would match them, so the roster must too —
    // otherwise the gate and the display disagree about who belongs.
    mockPrismaCommunity.findUnique.mockResolvedValueOnce({
      ...community,
      curators: [{ id: 2, username: 'grace' }]
    });

    await expect(listCommunityMembers(1)).resolves.toContainEqual({
      id: 1,
      username: 'ada',
      roles: ['leader']
    });
  });

  it('returns an empty roster for a community that does not exist', async () => {
    mockPrismaCommunity.findUnique.mockResolvedValueOnce(null);
    await expect(listCommunityMembers(99)).resolves.toEqual([]);
  });
});

describe('hasCommunityAccess', () => {
  it('returns true immediately for open communities', async () => {
    await expect(
      hasCommunityAccess(1, 7, RegistrationStatus.open)
    ).resolves.toBe(true);
    expect(mockPrismaCommunity.findFirst).not.toHaveBeenCalled();
  });

  it('composes the role union as a gate on one community', async () => {
    mockPrismaCommunity.findFirst.mockResolvedValueOnce({ id: 1 });

    await expect(
      hasCommunityAccess(1, 7, RegistrationStatus.closed)
    ).resolves.toBe(true);
    expect(mockPrismaCommunity.findFirst).toHaveBeenCalledWith({
      where: { id: 1, ...communityRoleUnion(7) },
      select: { id: true }
    });
  });

  it('returns false when the user holds no role in a restricted community', async () => {
    mockPrismaCommunity.findFirst.mockResolvedValueOnce(null);

    await expect(
      hasCommunityAccess(1, 7, RegistrationStatus.invite)
    ).resolves.toBe(false);
  });
});
