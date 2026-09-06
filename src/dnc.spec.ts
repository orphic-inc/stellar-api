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
  // #509 F5. This route is deliberately MEMBER-facing, not staff-only — the UI
  // renders the list in ContributeForm as the "must not be contributed"
  // warning. What changed is that it is now scoped to the community: it was
  // readable across every community by any authenticated member.
  const dncRows = [
    {
      id: 1,
      communityId: 5,
      name: 'Pirate Label',
      comment: 'Known bootlegger',
      userId: 7,
      createdAt: new Date('2026-01-01')
    }
  ];

  it('returns the list to a member of the community', async () => {
    // `open` short-circuits hasCommunityAccess without touching the union.
    prismaMock.community.findUnique.mockResolvedValue({
      registrationStatus: 'open'
    } as never);
    prismaMock.doNotContribute.findMany.mockResolvedValue(dncRows as never);
    prismaMock.user.findMany.mockResolvedValue([] as never);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Pirate Label');
  });

  it('admits a member of a closed community via the role union', async () => {
    prismaMock.community.findUnique.mockResolvedValue({
      registrationStatus: 'closed'
    } as never);
    prismaMock.community.findFirst.mockResolvedValue({ id: 5 } as never);
    prismaMock.doNotContribute.findMany.mockResolvedValue(dncRows as never);
    prismaMock.user.findMany.mockResolvedValue([] as never);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(200);
  });

  it('refuses a non-member of a closed community', async () => {
    // The behaviour this fix exists for: the free-text `comment` staff write
    // about why something is banned is no longer readable across communities.
    prismaMock.community.findUnique.mockResolvedValue({
      registrationStatus: 'closed'
    } as never);
    prismaMock.community.findFirst.mockResolvedValue(null);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(403);
    expect(prismaMock.doNotContribute.findMany).not.toHaveBeenCalled();
  });

  it('answers 404 for a community that does not exist', async () => {
    prismaMock.community.findUnique.mockResolvedValue(null);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(404);
    expect(prismaMock.doNotContribute.findMany).not.toHaveBeenCalled();
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
