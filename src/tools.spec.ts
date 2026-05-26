import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  setCurrentUserPermissions
} from './test/apiTestHarness';

const makeRank = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Member',
  level: 100,
  permissions: {},
  color: '#fff',
  badge: '',
  secondary: false,
  permittedForumIds: [],
  personalCollageLimit: 0,
  displayStaff: false,
  staffGroupId: null,
  _count: { users: 5, secondaryUsers: 0 },
  ...overrides
});

const makeGroup = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Moderators',
  sortOrder: 1,
  _count: { userRanks: 0 },
  ...overrides
});

beforeEach(() => resetApiTestState());

describe('GET /api/tools/user-ranks', () => {
  beforeEach(() => {
    setCurrentUserPermissions(
      makeUserRank({ admin: true }).permissions as Record<string, boolean>
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
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );

    const res = await request(app).get('/api/tools/user-ranks');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/tools/user-ranks/:id', () => {
  beforeEach(() => {
    setCurrentUserPermissions(
      makeUserRank({ admin: true }).permissions as Record<string, boolean>
    );
  });

  it('returns a single rank', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeRank() as never);

    const res = await request(app).get('/api/tools/user-ranks/1');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Member');
  });

  it('returns 404 when rank does not exist', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/tools/user-ranks/999');

    expect(res.status).toBe(404);
  });
});

describe('POST /api/tools/user-ranks', () => {
  beforeEach(() => {
    setCurrentUserPermissions(
      makeUserRank({ admin: true }).permissions as Record<string, boolean>
    );
  });

  it('creates a rank and returns 201', async () => {
    prismaMock.forum.count.mockResolvedValue(1);
    prismaMock.userRank.create.mockResolvedValue(makeRank() as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .post('/api/tools/user-ranks')
      .send({
        name: 'Member',
        level: 100,
        secondary: true,
        permittedForumIds: [1]
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Member');
    expect(prismaMock.userRank.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          secondary: true,
          permittedForumIds: [1]
        })
      })
    );
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
    setCurrentUserPermissions(
      makeUserRank({ admin: true }).permissions as Record<string, boolean>
    );
  });

  it('updates a rank and returns it', async () => {
    const updated = makeRank({ name: 'Elite Member' });
    prismaMock.userRank.findUnique.mockResolvedValue(makeRank() as never);
    prismaMock.forum.count.mockResolvedValue(1);
    prismaMock.userRank.update.mockResolvedValue(updated as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .put('/api/tools/user-ranks/1')
      .send({ name: 'Elite Member', permittedForumIds: [1] });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Elite Member');
  });

  it('returns 404 when rank does not exist', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/tools/user-ranks/999')
      .send({ name: 'Elite Member' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tools/user-ranks/:id', () => {
  beforeEach(() => {
    setCurrentUserPermissions(
      makeUserRank({ admin: true }).permissions as Record<string, boolean>
    );
  });

  it('deletes a rank and returns 204 when no users assigned', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.userSecondaryRank.count.mockResolvedValue(0);
    prismaMock.$transaction.mockResolvedValue([{}, {}] as never);

    const res = await request(app).delete('/api/tools/user-ranks/1');

    expect(res.status).toBe(204);
  });

  it('returns 409 when users are still assigned to the rank', async () => {
    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.userSecondaryRank.count.mockResolvedValue(1);

    const res = await request(app).delete('/api/tools/user-ranks/1');

    expect(res.status).toBe(409);
    expect(res.body.msg).toMatch(/3 user/);
  });
});

// ─── Staff Groups ──────────────────────────────────────────────────────────────

describe('GET /api/tools/staff-groups', () => {
  beforeEach(() => {
    setCurrentUserPermissions(
      makeUserRank({ admin: true }).permissions as Record<string, boolean>
    );
  });

  it('returns list of staff groups', async () => {
    prismaMock.staffGroup.findMany.mockResolvedValue([makeGroup()] as never);

    const res = await request(app).get('/api/tools/staff-groups');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].name).toBe('Moderators');
    expect(res.body[0].rankCount).toBe(0);
  });

  it('returns 403 for staff (not strict admin)', async () => {
    setCurrentUserPermissions(
      makeUserRank({ staff: true }).permissions as Record<string, boolean>
    );

    const res = await request(app).get('/api/tools/staff-groups');

    expect(res.status).toBe(403);
  });
});

describe('POST /api/tools/staff-groups', () => {
  beforeEach(() => {
    setCurrentUserPermissions(
      makeUserRank({ admin: true }).permissions as Record<string, boolean>
    );
  });

  it('creates a staff group and returns 201', async () => {
    prismaMock.staffGroup.create.mockResolvedValue(makeGroup() as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .post('/api/tools/staff-groups')
      .send({ name: 'Moderators', sortOrder: 1 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Moderators');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/tools/staff-groups')
      .send({ sortOrder: 1 });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/tools/user-ranks', () => {
  beforeEach(() => {
    setCurrentUserPermissions(
      makeUserRank({ admin: true }).permissions as Record<string, boolean>
    );
  });

  it('clears staffGroupId when displayStaff is false on create', async () => {
    prismaMock.staffGroup.findUnique.mockResolvedValue(makeGroup() as never);
    prismaMock.userRank.create.mockResolvedValue(
      makeRank({ displayStaff: false, staffGroupId: null }) as never
    );
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app).post('/api/tools/user-ranks').send({
      name: 'Member',
      level: 100,
      displayStaff: false,
      staffGroupId: 1
    });

    expect(res.status).toBe(201);
    expect(prismaMock.userRank.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          displayStaff: false,
          staffGroupId: null
        })
      })
    );
  });
});

describe('PUT /api/tools/staff-groups/:id', () => {
  beforeEach(() => {
    setCurrentUserPermissions(
      makeUserRank({ admin: true }).permissions as Record<string, boolean>
    );
  });

  it('updates a staff group and returns it', async () => {
    const updated = makeGroup({ name: 'Senior Mods' });
    prismaMock.staffGroup.findUnique.mockResolvedValue(makeGroup() as never);
    prismaMock.staffGroup.update.mockResolvedValue(updated as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .put('/api/tools/staff-groups/1')
      .send({ name: 'Senior Mods' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Senior Mods');
  });

  it('returns 404 when group does not exist', async () => {
    prismaMock.staffGroup.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/tools/staff-groups/999')
      .send({ name: 'Senior Mods' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tools/staff-groups/:id', () => {
  beforeEach(() => {
    setCurrentUserPermissions(
      makeUserRank({ admin: true }).permissions as Record<string, boolean>
    );
  });

  it('deletes a group and returns 204 when no ranks assigned', async () => {
    prismaMock.staffGroup.findUnique.mockResolvedValue({ id: 1 } as never);
    prismaMock.userRank.count.mockResolvedValue(0);
    prismaMock.$transaction.mockResolvedValue([{}, {}] as never);

    const res = await request(app).delete('/api/tools/staff-groups/1');

    expect(res.status).toBe(204);
  });

  it('returns 409 when ranks are still assigned to the group', async () => {
    prismaMock.staffGroup.findUnique.mockResolvedValue({ id: 1 } as never);
    prismaMock.userRank.count.mockResolvedValue(2);

    const res = await request(app).delete('/api/tools/staff-groups/1');

    expect(res.status).toBe(409);
    expect(res.body.msg).toMatch(/2 rank/);
  });

  it('returns 404 when the group does not exist', async () => {
    prismaMock.staffGroup.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/tools/staff-groups/999');

    expect(res.status).toBe(404);
  });
});
