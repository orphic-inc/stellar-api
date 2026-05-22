import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';

const makeRank = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Member',
  level: 100,
  permissions: {},
  color: '#fff',
  badge: '',
  personalCollageLimit: 0,
  _count: { users: 5 },
  ...overrides
});

beforeEach(() => resetApiTestState());

describe('GET /api/tools/user-ranks', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
  });

  it('returns list of user ranks with user counts', async () => {
    prismaMock.userRank.findMany.mockResolvedValue([makeRank()] as never);

    const res = await request(app).get('/api/tools/user-ranks');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].name).toBe('Member');
    expect(res.body[0].userCount).toBe(5);
  });

  it('returns 403 without admin permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

    const res = await request(app).get('/api/tools/user-ranks');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/tools/user-ranks/:id', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
  });

  it('returns a single rank', async () => {
    prismaMock.userRank.findUnique
      .mockResolvedValueOnce(makeUserRank({ admin: true }) as never)
      .mockResolvedValueOnce(makeRank() as never);

    const res = await request(app).get('/api/tools/user-ranks/1');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Member');
  });

  it('returns 404 when rank does not exist', async () => {
    prismaMock.userRank.findUnique
      .mockResolvedValueOnce(makeUserRank({ admin: true }) as never)
      .mockResolvedValueOnce(null);

    const res = await request(app).get('/api/tools/user-ranks/999');

    expect(res.status).toBe(404);
  });
});

describe('POST /api/tools/user-ranks', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
  });

  it('creates a rank and returns 201', async () => {
    prismaMock.userRank.create.mockResolvedValue(makeRank() as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .post('/api/tools/user-ranks')
      .send({ name: 'Member', level: 100 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Member');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/tools/user-ranks')
      .send({ level: 100 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when level is missing', async () => {
    const res = await request(app)
      .post('/api/tools/user-ranks')
      .send({ name: 'Member' });

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/tools/user-ranks/:id', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
  });

  it('updates a rank and returns it', async () => {
    const updated = makeRank({ name: 'Elite Member' });
    prismaMock.userRank.update.mockResolvedValue(updated as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .put('/api/tools/user-ranks/1')
      .send({ name: 'Elite Member' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Elite Member');
  });
});

describe('DELETE /api/tools/user-ranks/:id', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
  });

  it('deletes a rank and returns 204 when no users assigned', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.$transaction.mockResolvedValue([{}, {}] as never);

    const res = await request(app).delete('/api/tools/user-ranks/1');

    expect(res.status).toBe(204);
  });

  it('returns 409 when users are still assigned to the rank', async () => {
    prismaMock.user.count.mockResolvedValue(3);

    const res = await request(app).delete('/api/tools/user-ranks/1');

    expect(res.status).toBe(409);
    expect(res.body.msg).toMatch(/3 user/);
  });
});
