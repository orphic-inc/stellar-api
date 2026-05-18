import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

const setManager = () =>
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({ communities_manage: true })
  );

const BASE = '/api/communities/5/dnu';

// ─── GET /api/communities/:communityId/dnu ─────────────────────────────────────

describe('GET /api/communities/:communityId/dnu', () => {
  beforeEach(() => setManager());

  it('returns the DNU list for the community', async () => {
    prismaMock.doNotUpload.findMany.mockResolvedValue([
      {
        id: 1,
        communityId: 5,
        name: 'Pirate Label',
        comment: 'Known bootlegger',
        userId: 7,
        createdAt: new Date('2026-01-01')
      }
    ] as never);

    const res = await request(app).get(BASE);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Pirate Label');
  });

  it('returns 403 without communities_manage permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app).get(BASE);
    expect(res.status).toBe(403);
  });
});

// ─── POST /api/communities/:communityId/dnu ────────────────────────────────────

describe('POST /api/communities/:communityId/dnu', () => {
  beforeEach(() => setManager());

  it('creates a DNU entry and returns 201', async () => {
    prismaMock.community.findUnique.mockResolvedValue({ id: 5 } as never);
    prismaMock.doNotUpload.create.mockResolvedValue({
      id: 2,
      communityId: 5,
      name: 'Bad Label',
      comment: 'Do not upload',
      userId: 7,
      createdAt: new Date('2026-01-01')
    } as never);

    const res = await request(app)
      .post(BASE)
      .send({ name: 'Bad Label', comment: 'Do not upload' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Bad Label');
    expect(prismaMock.doNotUpload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          communityId: 5,
          name: 'Bad Label',
          comment: 'Do not upload',
          userId: 7
        })
      })
    );
  });

  it('returns 404 when the community does not exist', async () => {
    prismaMock.community.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(BASE)
      .send({ name: 'Bad Label', comment: 'Do not upload' });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Community not found');
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post(BASE).send({ name: 'Bad Label' });
    expect(res.status).toBe(400);
  });

  it('returns 403 without communities_manage permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app)
      .post(BASE)
      .send({ name: 'Bad Label', comment: 'Do not upload' });
    expect(res.status).toBe(403);
  });
});

// ─── DELETE /api/communities/:communityId/dnu/:dnuId ──────────────────────────

describe('DELETE /api/communities/:communityId/dnu/:dnuId', () => {
  beforeEach(() => setManager());

  it('deletes a DNU entry and returns 204', async () => {
    prismaMock.doNotUpload.findFirst.mockResolvedValue({
      id: 3,
      communityId: 5
    } as never);
    prismaMock.doNotUpload.delete.mockResolvedValue({} as never);

    const res = await request(app).delete(`${BASE}/3`);

    expect(res.status).toBe(204);
    expect(prismaMock.doNotUpload.delete).toHaveBeenCalledWith({
      where: { id: 3 }
    });
  });

  it('returns 404 when the entry does not exist for this community', async () => {
    prismaMock.doNotUpload.findFirst.mockResolvedValue(null);

    const res = await request(app).delete(`${BASE}/99`);

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('DNU entry not found');
  });

  it('returns 403 without communities_manage permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app).delete(`${BASE}/3`);
    expect(res.status).toBe(403);
  });
});
