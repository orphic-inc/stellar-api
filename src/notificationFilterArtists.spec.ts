/**
 * `artists` on a NotificationFilter (#715): the names the UI shows beside
 * `artistIds`, read in one query per response rather than one per chip.
 * `artistIds` stays the value written back; `artists` is display only.
 */
import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  setCurrentUserPermissions
} from './test/apiTestHarness';

const filter = (id: number, artistIds: number[]) => ({
  id,
  label: `Filter ${id}`,
  artistIds
});

beforeEach(() => {
  resetApiTestState();
  setCurrentUserPermissions({});
  prismaMock.userRank.findUnique.mockResolvedValue({
    notificationFilterLimit: null
  } as never);
  prismaMock.tagAlias.findMany.mockResolvedValue([]);
});

describe('GET /api/notification-filters — artist names', () => {
  it('names each filter’s artists in artistIds order, from one query', async () => {
    prismaMock.notificationFilter.findMany.mockResolvedValue([
      filter(1, [9, 4]),
      filter(2, [4])
    ] as never);
    prismaMock.artist.findMany.mockResolvedValue([
      { id: 4, name: 'Slowdive' },
      { id: 9, name: 'Ride' }
    ] as never);

    const res = await request(app).get('/api/notification-filters');

    expect(res.status).toBe(200);
    expect(
      res.body.filters.map((f: { artists: unknown }) => f.artists)
    ).toEqual([
      [
        { id: 9, name: 'Ride' },
        { id: 4, name: 'Slowdive' }
      ],
      [{ id: 4, name: 'Slowdive' }]
    ]);
    expect(prismaMock.artist.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.artist.findMany).toHaveBeenCalledWith({
      where: { id: { in: [9, 4] }, deletedAt: null },
      select: { id: true, name: true }
    });
  });

  it('leaves a removed artist out of artists but keeps its id', async () => {
    prismaMock.notificationFilter.findMany.mockResolvedValue([
      filter(1, [4, 7])
    ] as never);
    prismaMock.artist.findMany.mockResolvedValue([
      { id: 4, name: 'Slowdive' }
    ] as never);

    const res = await request(app).get('/api/notification-filters');

    expect(res.body.filters[0].artistIds).toEqual([4, 7]);
    expect(res.body.filters[0].artists).toEqual([{ id: 4, name: 'Slowdive' }]);
  });

  it('skips the artist query when no filter names an artist', async () => {
    prismaMock.notificationFilter.findMany.mockResolvedValue([
      filter(1, [])
    ] as never);

    const res = await request(app).get('/api/notification-filters');

    expect(res.body.filters[0].artists).toEqual([]);
    expect(prismaMock.artist.findMany).not.toHaveBeenCalled();
  });
});

describe('writes answer with artist names too', () => {
  beforeEach(() => {
    prismaMock.artist.count.mockResolvedValue(1);
    prismaMock.artist.findMany.mockResolvedValue([
      { id: 4, name: 'Slowdive' }
    ] as never);
  });

  it('POST', async () => {
    prismaMock.notificationFilter.create.mockResolvedValue(
      filter(1, [4]) as never
    );
    const res = await request(app)
      .post('/api/notification-filters')
      .send({ label: 'Shoegaze', artistIds: [4] });
    expect(res.status).toBe(201);
    expect(res.body.artists).toEqual([{ id: 4, name: 'Slowdive' }]);
  });

  it('PUT', async () => {
    prismaMock.notificationFilter.count.mockResolvedValue(1);
    prismaMock.notificationFilter.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.notificationFilter.findUniqueOrThrow.mockResolvedValue(
      filter(1, [4]) as never
    );
    const res = await request(app)
      .put('/api/notification-filters/1')
      .send({ label: 'Shoegaze', artistIds: [4] });
    expect(res.status).toBe(200);
    expect(res.body.artists).toEqual([{ id: 4, name: 'Slowdive' }]);
  });

  it('the staff read', async () => {
    setCurrentUserPermissions({ users_edit: true });
    prismaMock.notificationFilter.findMany.mockResolvedValue([
      filter(1, [4])
    ] as never);
    const res = await request(app).get('/api/users/12/notification-filters');
    expect(res.status).toBe(200);
    expect(res.body[0].artists).toEqual([{ id: 4, name: 'Slowdive' }]);
  });
});
