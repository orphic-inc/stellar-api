/**
 * Staff ranks are never a promotion target (#866). A rank is auto-managed when
 * it is primary and below STAFF_LEVEL (500); only those form the promotion
 * ladder, and `UserRank.autoManaged` says which they are. Kept apart from
 * tools.spec.ts, which is already long.
 */
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
  level: 150,
  permissions: {},
  color: '',
  badge: '',
  secondary: false,
  permittedForumIds: [],
  personalCollageLimit: 0,
  displayStaff: false,
  staffGroupId: null,
  _count: { users: 0, secondaryUsers: 0 },
  ...overrides
});

const makeRule = (id: number, fromRankId: number, toRankId: number) => ({
  id,
  fromRankId,
  toRankId,
  fromRank: { name: `Rank ${fromRankId}` },
  toRank: { name: `Rank ${toRankId}` },
  minContributed: BigInt(0),
  minRatio: 0,
  minContributions: 0,
  minAccountAgeDays: 0,
  extra: null,
  enabled: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z')
});

beforeEach(() => {
  resetApiTestState();
  setCurrentUserPermissions(
    makeUserRank({ rank_permissions_manage: true }).permissions as Record<
      string,
      boolean
    >
  );
});

describe('UserRank.autoManaged (#866)', () => {
  it('is true only for a primary rank below the staff level', async () => {
    prismaMock.userRank.findMany.mockResolvedValue([
      makeRank({ id: 1, level: 450 }),
      makeRank({ id: 2, level: 500, name: 'Staff' }),
      makeRank({ id: 3, level: 120, name: 'Donor', secondary: true })
    ] as never);

    const res = await request(app).get('/api/tools/user-ranks');

    expect(res.status).toBe(200);
    expect(
      res.body.map((r: { id: number; autoManaged: boolean }) => [
        r.id,
        r.autoManaged
      ])
    ).toEqual([
      [1, true],
      [2, false],
      [3, false]
    ]);
  });
});

describe('promotion rules refuse a staff end (#866)', () => {
  // Stellarige 450 → Staff 500 → SysOp 1000: each pair is adjacent by level,
  // so only the staff boundary can refuse it.
  const levels: Record<number, number> = { 7: 450, 8: 500, 9: 1000 };

  it.each([
    ['toRank', 7, 8],
    ['fromRank', 8, 9]
  ])(
    'returns 422 when %s is a staff rank',
    async (_end, fromRankId, toRankId) => {
      prismaMock.userRank.findUnique.mockImplementation(((args: {
        where: { id: number };
      }) =>
        Promise.resolve({
          level: levels[args.where.id],
          secondary: false
        })) as never);
      prismaMock.userRank.findMany.mockResolvedValue([] as never);

      const res = await request(app)
        .post('/api/tools/promotion-rules')
        .send({ fromRankId, toRankId });

      expect(res.status).toBe(422);
      expect(res.body.msg).toMatch(/staff level \(500\)/);
      expect(prismaMock.rankPromotionRule.create).not.toHaveBeenCalled();
    }
  );
});

describe('a rank moved to the staff level strands its rules (#866)', () => {
  it('reports the rule into it, though the levels stay adjacent', async () => {
    // Member 150 → Power User 200; Power User moves to 500 and becomes staff.
    // 150 → 500 is still the next step up, so only the boundary strands it.
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeRank({ id: 3, level: 200 }) as never
    );
    prismaMock.userRank.update.mockResolvedValue(
      makeRank({ id: 3, level: 500 }) as never
    );
    prismaMock.auditLog.create.mockResolvedValue({} as never);
    prismaMock.userRank.findMany.mockResolvedValue([
      { id: 2, level: 150, secondary: false },
      { id: 3, level: 500, secondary: false }
    ] as never);
    prismaMock.rankPromotionRule.findMany.mockResolvedValue([
      makeRule(5, 2, 3)
    ] as never);

    const res = await request(app)
      .put('/api/tools/user-ranks/3')
      .send({ level: 500 });

    expect(res.status).toBe(200);
    expect(res.body.autoManaged).toBe(false);
    expect(res.body.staleRules.map((r: { id: number }) => r.id)).toEqual([5]);
  });
});
