import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  getInviteSubtreeRows,
  getMemberInviteTreeView,
  type InviteTreeViewNode
} from '../modules/user';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;
const mkUser = async (
  opts: { contributed?: bigint; consumed?: bigint; showStats?: boolean } = {}
) => {
  seq += 1;
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({
    data: {
      showContributedStats: opts.showStats ?? true,
      showConsumedStats: opts.showStats ?? true
    }
  });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `it-tree-${seq}`,
      email: `it-tree-${seq}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      contributed: opts.contributed ?? 0n,
      consumed: opts.consumed ?? 0n
    }
  });
};

const link = (userId: number, inviterId: number) =>
  testPrisma.inviteTree.create({ data: { userId, inviterId } });

const find = (
  nodes: InviteTreeViewNode[],
  userId: number
): InviteTreeViewNode | undefined => {
  for (const n of nodes) {
    if (n.userId === userId) return n;
    const hit = find(n.children, userId);
    if (hit) return hit;
  }
  return undefined;
};

// Tree:  R → {A, B};  A → {C}.  B is paranoid (stats hidden).
const seedTree = async () => {
  const root = await mkUser();
  const a = await mkUser({ contributed: 100n, consumed: 50n });
  const b = await mkUser({
    contributed: 200n,
    consumed: 100n,
    showStats: false
  });
  const c = await mkUser({ contributed: 30n, consumed: 10n });
  await link(a.id, root.id);
  await link(b.id, root.id);
  await link(c.id, a.id);
  return { root, a, b, c };
};

describe('getInviteSubtreeRows', () => {
  it('returns all descendants with their depth', async () => {
    const { root, a, b, c } = await seedTree();
    const rows = await getInviteSubtreeRows(root.id);

    const byId = new Map(rows.map((r) => [r.userId, r]));
    expect([...byId.keys()].sort((x, y) => x - y)).toEqual(
      [a.id, b.id, c.id].sort((x, y) => x - y)
    );
    expect(byId.get(a.id)!.depth).toBe(1);
    expect(byId.get(b.id)!.depth).toBe(1);
    expect(byId.get(c.id)!.depth).toBe(2);
  });
});

describe('getMemberInviteTreeView', () => {
  it('nests the subtree and summarizes it, paranoia included in totals', async () => {
    const { root, a, c } = await seedTree();
    const { tree, summary } = await getMemberInviteTreeView(root.id, false);

    // C nests under A.
    expect(find(tree, a.id)!.children.map((n) => n.userId)).toEqual([c.id]);

    expect(summary.entries).toBe(3);
    expect(summary.branches).toBe(2);
    expect(summary.depth).toBe(2);
    expect(summary.hiddenCount).toBe(1); // B is paranoid
    // Totals include paranoid B: 100+200+30 / 50+100+10
    expect(summary.total).toEqual({
      contributed: '330',
      consumed: '160',
      ratio: (330 / 160).toFixed(2)
    });
    // Top level = direct invitees A + B: 300 / 150
    expect(summary.topLevel.contributed).toBe('300');
  });

  it('hides a paranoid member’s stats unless privacy is overridden', async () => {
    const { root, b } = await seedTree();

    const gated = await getMemberInviteTreeView(root.id, false);
    expect(find(gated.tree, b.id)!.stats).toBeNull();

    const staffView = await getMemberInviteTreeView(root.id, true);
    expect(find(staffView.tree, b.id)!.stats).toEqual({
      contributed: '200',
      consumed: '100',
      ratio: '2.00'
    });
  });
});
