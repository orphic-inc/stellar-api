import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  setCurrentUserPermissions
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

const setManager = () =>
  setCurrentUserPermissions(
    makeUserRank({ dnc_manage: true }).permissions as Record<string, boolean>
  );

const BASE = '/api/communities/5/dnc';

// ─── GET /api/communities/:communityId/dnc ─────────────────────────────────────

describe('GET /api/communities/:communityId/dnc', () => {
  it('returns the DNC list for any authenticated user', async () => {
    prismaMock.doNotContribute.findMany.mockResolvedValue([
      {
        id: 1,
        communityId: 5,
        name: 'Pirate Label',
        comment: 'Known bootlegger',
        userId: 7,
        createdAt: new Date('2026-01-01')
      }
    ] as never);
    prismaMock.user.findMany.mockResolvedValue([] as never);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Pirate Label');
  });
});

// ─── POST /api/communities/:communityId/dnc ────────────────────────────────────

describe('POST /api/communities/:communityId/dnc', () => {
  beforeEach(() => setManager());

  it('creates a DNC entry and returns 201', async () => {
    prismaMock.community.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.doNotContribute.create.mockResolvedValue({
      id: 2,
      communityId: 5,
      name: 'Bad Label',
      comment: 'Do not contribute',
      userId: 7,
      createdAt: new Date('2026-01-01')
    } as never);

    const res = await request(app)
      .post(BASE)
      .send({ name: 'Bad Label', comment: 'Do not contribute' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Bad Label');
    expect(prismaMock.doNotContribute.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          communityId: 5,
          name: 'Bad Label',
          comment: 'Do not contribute',
          userId: 7
        })
      })
    );
  });

  it('returns 404 when the community does not exist', async () => {
    prismaMock.community.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(BASE)
      .send({ name: 'Bad Label', comment: 'Do not contribute' });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Community not found');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post(BASE).send({ comment: 'No name' });
    expect(res.status).toBe(400);
  });

  it('returns 403 without dnc_manage permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    const res = await request(app)
      .post(BASE)
      .send({ name: 'Bad Label', comment: 'Do not contribute' });
    expect(res.status).toBe(403);
  });
});

// ─── DELETE /api/communities/:communityId/dnc/:dncId ──────────────────────────

describe('DELETE /api/communities/:communityId/dnc/:dncId', () => {
  beforeEach(() => setManager());

  it('deletes a DNC entry and returns 204', async () => {
    prismaMock.doNotContribute.findFirst.mockResolvedValue({
      id: 3,
      communityId: 5
    } as never);
    prismaMock.doNotContribute.delete.mockResolvedValue({} as never);

    const res = await request(app).delete(`${BASE}/3`);

    expect(res.status).toBe(204);
    expect(prismaMock.doNotContribute.delete).toHaveBeenCalledWith({
      where: { id: 3 }
    });
  });

  it('returns 404 when the entry does not exist for this community', async () => {
    prismaMock.doNotContribute.findFirst.mockResolvedValue(null);

    const res = await request(app).delete(`${BASE}/99`);

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('DNC entry not found');
  });

  it('returns 403 without dnc_manage permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    const res = await request(app).delete(`${BASE}/3`);
    expect(res.status).toBe(403);
  });
});
