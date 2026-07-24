/**
 * Unit tests for the shared community access predicate (#419, ADR-0030 slice 3).
 */

const mockPrismaCommunity = { findFirst: jest.fn() };

jest.mock('../lib/prisma', () => ({
  prisma: { community: mockPrismaCommunity }
}));

import { RegistrationStatus } from '@prisma/client';
import { communityRoleUnion, hasCommunityAccess } from './communityAccess';

describe('communityRoleUnion', () => {
  it('unions every Axis-1 relation that makes a user part of a community', () => {
    expect(communityRoleUnion(7)).toEqual({
      OR: [
        { consumers: { some: { userId: 7 } } },
        { contributors: { some: { userId: 7 } } },
        { staff: { some: { id: 7 } } },
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
      'staff',
      'leaderId'
    ]);
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
