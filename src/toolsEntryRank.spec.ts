import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  setCurrentUserPermissions
} from './test/apiTestHarness';

/**
 * The entry rank keeps its level (#882). Registration, staff-created users and
 * the System user take the rank at level 100, and the boot seed no longer
 * recreates one, so moving it would break every new account.
 */
const makeRank = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'User',
  level: 100,
  permissions: {},
  color: '',
  badge: '',
  secondary: false,
  permittedForumIds: [],
  personalCollageLimit: 1,
  authorStylesheetLimit: 1,
  assetLimit: 1,
  displayStaff: false,
  staffGroupId: null,
  _count: { users: 0, secondaryUsers: 0 },
  ...overrides
});

beforeEach(() => {
  resetApiTestState();
  setCurrentUserPermissions(
    makeUserRank({ rank_permissions_manage: true }).permissions as Record<
      string,
      boolean
    >
  );
  prismaMock.auditLog.create.mockResolvedValue({} as never);
});

describe('PUT /api/tools/user-ranks/:id — the entry rank (#882)', () => {
  it('refuses to move the level-100 rank to another level', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeRank() as never);

    const res = await request(app)
      .put('/api/tools/user-ranks/1')
      .send({ level: 120 });

    expect(res.status).toBe(409);
    expect(res.body.msg).toMatch(/level 100/);
    expect(prismaMock.userRank.update).not.toHaveBeenCalled();
  });

  it('still lets staff rename it and edit the rest', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeRank() as never);
    prismaMock.userRank.update.mockResolvedValue(
      makeRank({ name: 'Newcomer' }) as never
    );

    const res = await request(app)
      .put('/api/tools/user-ranks/1')
      .send({ name: 'Newcomer', level: 100, assetLimit: 2 });

    expect(res.status).toBe(200);
    expect(prismaMock.userRank.update).toHaveBeenCalled();
  });

  it('leaves every other rank free to change level', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeRank({ id: 2, name: 'Member', level: 150 }) as never
    );
    prismaMock.userRank.update.mockResolvedValue(
      makeRank({ id: 2, name: 'Member', level: 160 }) as never
    );
    // A level change reports the promotion rules it strands (#718).
    prismaMock.userRank.findMany.mockResolvedValue([] as never);
    prismaMock.rankPromotionRule.findMany.mockResolvedValue([] as never);

    const res = await request(app)
      .put('/api/tools/user-ranks/2')
      .send({ level: 160 });

    expect(res.status).toBe(200);
  });
});
