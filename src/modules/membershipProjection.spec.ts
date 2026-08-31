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

const mockCommunityFindMany = jest.fn();
const mockUserFindMany = jest.fn();
jest.mock('../lib/prisma', () => ({
  prisma: {
    community: { findMany: mockCommunityFindMany },
    user: { findMany: mockUserFindMany }
  }
}));

const mockListCommunityMembers = jest.fn();
jest.mock('./communityAccess', () => ({
  listCommunityMembers: mockListCommunityMembers
}));

import {
  listPrivateCommunityIds,
  getCommunityMemberNicks,
  projectCommunityMembership,
  reconcileCommunityMembership
} from './membershipProjection';

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
});

describe('listPrivateCommunityIds', () => {
  it('selects only PRIVATE communities', async () => {
    mockCommunityFindMany.mockResolvedValue([{ id: 3 }, { id: 9 }]);
    await expect(listPrivateCommunityIds()).resolves.toEqual([3, 9]);
    expect(mockCommunityFindMany.mock.calls[0][0].where).toEqual({
      announceVisibility: 'PRIVATE'
    });
  });
});

describe('getCommunityMemberNicks', () => {
  it('composes the role union rather than re-deriving it', async () => {
    // The point of this assertion is the delegation, not the result: the union's
    // arms are defined once in communityAccess.ts and must not be restated here.
    mockListCommunityMembers.mockResolvedValue([
      { id: 1, username: 'a', roles: ['consumer'] },
      { id: 2, username: 'b', roles: ['curator'] }
    ]);
    mockUserFindMany.mockResolvedValue([
      { ircNick: 'zed' },
      { ircNick: 'ann' }
    ]);

    const nicks = await getCommunityMemberNicks(7);

    expect(mockListCommunityMembers).toHaveBeenCalledWith(7);
    expect(nicks).toEqual(['ann', 'zed']); // sorted, for diffable logs
    expect(mockUserFindMany.mock.calls[0][0].where.id).toEqual({ in: [1, 2] });
  });

  it('excludes unverified claims and disabled accounts', async () => {
    // ircNick holds only a *verified* nick (ADR-0015); a pendingIrcNick claim
    // reaching a channel ACL would let anyone claim another member's visibility.
    mockListCommunityMembers.mockResolvedValue([
      { id: 1, username: 'a', roles: ['consumer'] }
    ]);
    mockUserFindMany.mockResolvedValue([]);

    await getCommunityMemberNicks(7);

    const where = mockUserFindMany.mock.calls[0][0].where;
    expect(where.ircNick).toEqual({ not: null });
    expect(where.disabled).toBe(false);
  });

  it('returns an empty set for a community with no members, without querying users', async () => {
    mockListCommunityMembers.mockResolvedValue([]);
    await expect(getCommunityMemberNicks(7)).resolves.toEqual([]);
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });
});

describe('projectCommunityMembership', () => {
  const bodyOf = (): Record<string, unknown> =>
    JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body as string
    ) as Record<string, unknown>;

  it('posts the pinned contract: numeric id and the full nick set', async () => {
    await projectCommunityMembership(7, ['ann', 'zed']);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://korin.test/irc/membership');
    expect(init.method).toBe('POST');
    expect(init.headers['x-pull-key']).toBe('pk');
    // Numeric Community.id, never a name or slug — korin derives #c-<id>.
    expect(bodyOf()).toEqual({ community: 7, nicks: ['ann', 'zed'] });
  });

  it('projects an empty set verbatim rather than skipping the push', async () => {
    // "Nobody may see this" is a legitimate state. Skipping would leave korin
    // holding an ACL stellar believes it has replaced.
    await expect(projectCommunityMembership(7, [])).resolves.toBe(true);
    expect(bodyOf()).toEqual({ community: 7, nicks: [] });
  });

  it('returns false on a non-2xx without throwing', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(projectCommunityMembership(7, ['ann'])).resolves.toBe(false);
  });

  it('returns false when the fetch itself rejects', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(projectCommunityMembership(7, ['ann'])).resolves.toBe(false);
  });
});

describe('reconcileCommunityMembership', () => {
  it('reads then projects', async () => {
    mockListCommunityMembers.mockResolvedValue([
      { id: 1, username: 'a', roles: ['consumer'] }
    ]);
    mockUserFindMany.mockResolvedValue([{ ircNick: 'ann' }]);

    await expect(reconcileCommunityMembership(7)).resolves.toBe(true);
    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body as string
    ) as Record<string, unknown>;
    expect(body).toEqual({ community: 7, nicks: ['ann'] });
  });
});
