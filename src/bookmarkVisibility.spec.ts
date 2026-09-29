/**
 * Community and request bookmarks apply the visibility rule their entities'
 * own reads apply (#772, an instance of #771), as release bookmarks already
 * did (ADR-0036 §5): the create arm of the toggle is gated, the lists are
 * filtered, and un-bookmarking stays open. Before, bookmarking any id and then
 * listing echoed a hidden request's title or a private community's name.
 */
import {
  communityReadableWhere,
  requestVisibleTo
} from './modules/communityAccess';
import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

describe.each([
  {
    segment: 'communities',
    label: 'Community',
    lookup: () => prismaMock.community.findFirst,
    bookmark: () => prismaMock.bookmarkCommunity,
    scope: { id: 3, ...communityReadableWhere(7) }
  },
  {
    segment: 'requests',
    label: 'Request',
    lookup: () => prismaMock.request.findFirst,
    bookmark: () => prismaMock.bookmarkRequest,
    scope: { id: 3, deletedAt: null, ...requestVisibleTo(7) }
  }
])('POST /api/bookmarks/$segment/:id (#772)', (c) => {
  const post = () => request(app).post(`/api/bookmarks/${c.segment}/3`);

  it('answers a hidden id as a missing one, and creates nothing', async () => {
    c.lookup().mockResolvedValue(null);
    c.bookmark().findUnique.mockResolvedValue(null);

    const res = await post();

    // The same status and message as the P2003 arm, so the answer does not
    // reveal that the id is real and hidden.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: `${c.label} not found` });
    expect(c.bookmark().create).not.toHaveBeenCalled();
  });

  it('scopes the visibility check to the caller', async () => {
    c.lookup().mockResolvedValue({ id: 3 } as never);
    c.bookmark().findUnique.mockResolvedValue(null);
    c.bookmark().create.mockResolvedValue({} as never);

    await post();

    // Assert the query: only the where clause proves the filter was applied.
    expect(c.lookup()).toHaveBeenCalledWith({
      where: c.scope,
      select: { id: true }
    });
  });

  it('still un-bookmarks an id the caller can no longer see', async () => {
    // The delete arm is ungated (ADR-0036 §5): a member who lost access keeps
    // a row they must still be able to remove.
    c.lookup().mockResolvedValue(null);
    c.bookmark().findUnique.mockResolvedValue({ userId: 7 } as never);
    c.bookmark().deleteMany.mockResolvedValue({ count: 1 } as never);

    const res = await post();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookmarked: false });
    expect(c.lookup()).not.toHaveBeenCalled();
  });
});

describe('bookmark lists filter what the caller cannot see (#772)', () => {
  it('GET /api/bookmarks/communities keeps only readable communities', async () => {
    prismaMock.bookmarkCommunity.findMany.mockResolvedValue([] as never);

    await request(app).get('/api/bookmarks/communities');

    expect(prismaMock.bookmarkCommunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 7, community: communityReadableWhere(7) }
      })
    );
  });

  it('GET /api/bookmarks/requests keeps only visible requests', async () => {
    prismaMock.bookmarkRequest.findMany.mockResolvedValue([] as never);

    await request(app).get('/api/bookmarks/requests');

    expect(prismaMock.bookmarkRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 7,
          request: { deletedAt: null, ...requestVisibleTo(7) }
        }
      })
    );
  });
});
