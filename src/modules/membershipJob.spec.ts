jest.mock('./config', () => ({
  korin: { apiUrl: 'https://korin.test', pullKey: 'pk', pollIntervalMs: 1000 }
}));
jest.mock('./logging', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const mockListPrivateCommunityIds = jest.fn();
const mockReconcileCommunityMembership = jest.fn();
jest.mock('./membershipProjection', () => ({
  listPrivateCommunityIds: mockListPrivateCommunityIds,
  reconcileCommunityMembership: mockReconcileCommunityMembership
}));

import { runMembershipReconcileCycle } from './membershipJob';

beforeEach(() => {
  mockListPrivateCommunityIds.mockReset();
  mockReconcileCommunityMembership.mockReset();
});

describe('runMembershipReconcileCycle', () => {
  it('projects every private community', async () => {
    mockListPrivateCommunityIds.mockResolvedValue([3, 9, 12]);
    mockReconcileCommunityMembership.mockResolvedValue(true);

    await expect(runMembershipReconcileCycle()).resolves.toEqual({
      attempted: 3,
      succeeded: 3
    });
    expect(
      mockReconcileCommunityMembership.mock.calls.map(([id]) => id)
    ).toEqual([3, 9, 12]);
  });

  it('does NOT stop at a failure — unlike the announce cursor', async () => {
    // This is the load-bearing difference from runAnnounceCycle, which holds its
    // cursor at the first failure to preserve ordering. A full-set projection is
    // idempotent and order-free: community 12's ACL has nothing to do with 3's,
    // so stopping would strand 12 for no reason. Everything retries next tick.
    mockListPrivateCommunityIds.mockResolvedValue([3, 9, 12]);
    mockReconcileCommunityMembership
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(runMembershipReconcileCycle()).resolves.toEqual({
      attempted: 3,
      succeeded: 1
    });
    expect(
      mockReconcileCommunityMembership.mock.calls.map(([id]) => id)
    ).toEqual([3, 9, 12]);
  });

  it('holds no cursor — a failed community is retried whole next tick', async () => {
    mockListPrivateCommunityIds.mockResolvedValue([3]);
    mockReconcileCommunityMembership.mockResolvedValue(false);

    await runMembershipReconcileCycle();
    await runMembershipReconcileCycle();

    // Same community attempted both passes; nothing was skipped or advanced.
    expect(
      mockReconcileCommunityMembership.mock.calls.map(([id]) => id)
    ).toEqual([3, 3]);
  });

  it('is a no-op when no community is private', async () => {
    mockListPrivateCommunityIds.mockResolvedValue([]);
    await expect(runMembershipReconcileCycle()).resolves.toEqual({
      attempted: 0,
      succeeded: 0
    });
    expect(mockReconcileCommunityMembership).not.toHaveBeenCalled();
  });
});
