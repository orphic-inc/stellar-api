import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  setCurrentUserPermissions
} from './test/apiTestHarness';

/**
 * The nullable rank limits on the rank routes (#881): `null` is unlimited and
 * `0` is none, for `personalCollageLimit` and `authorStylesheetLimit` as for
 * `assetLimit`. An explicit `null` must survive create, where `?? 0` would
 * collapse it to none, and a rank created without the field grants nothing.
 */
const LIMITS = ['personalCollageLimit', 'authorStylesheetLimit'] as const;

const makeRank = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Member',
  level: 100,
  permissions: {},
  color: '',
  badge: '',
  secondary: false,
  permittedForumIds: [],
  personalCollageLimit: 0,
  authorStylesheetLimit: 0,
  assetLimit: 0,
  displayStaff: false,
  staffGroupId: null,
  _count: { users: 0, secondaryUsers: 0 },
  ...overrides
});

const createdWith = () =>
  (prismaMock.userRank.create.mock.calls[0][0] as { data: object }).data;

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

describe.each(LIMITS)('%s on the rank routes (#881)', (field) => {
  it('stores an explicit null on create as unlimited', async () => {
    prismaMock.userRank.create.mockResolvedValue(
      makeRank({ [field]: null }) as never
    );

    const res = await request(app)
      .post('/api/tools/user-ranks')
      .send({ name: 'Member', level: 100, [field]: null });

    expect(res.status).toBe(201);
    expect(createdWith()).toMatchObject({ [field]: null });
    expect(res.body[field]).toBeNull();
  });

  it('stores 0, none, when create leaves the field out', async () => {
    prismaMock.userRank.create.mockResolvedValue(makeRank() as never);

    await request(app)
      .post('/api/tools/user-ranks')
      .send({ name: 'Member', level: 100 });

    expect(createdWith()).toMatchObject({ [field]: 0 });
  });

  it('writes an explicit null on update', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeRank() as never);
    prismaMock.userRank.update.mockResolvedValue(
      makeRank({ [field]: null }) as never
    );

    const res = await request(app)
      .put('/api/tools/user-ranks/1')
      .send({ [field]: null });

    expect(res.status).toBe(200);
    expect(prismaMock.userRank.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ [field]: null })
      })
    );
  });

  it('refuses a negative value', async () => {
    const res = await request(app)
      .post('/api/tools/user-ranks')
      .send({ name: 'Member', level: 100, [field]: -1 });

    expect(res.status).toBe(400);
    expect(prismaMock.userRank.create).not.toHaveBeenCalled();
  });
});
