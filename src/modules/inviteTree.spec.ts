import {
  buildInviteSubtree,
  summarizeInviteTree,
  type InviteTreeRow,
  type InviteTreeNode
} from './inviteTree';

const row = (
  userId: number,
  inviterId: number | null,
  over: Partial<InviteTreeRow> = {}
): InviteTreeRow => ({
  userId,
  inviterId,
  username: `u${userId}`,
  disabled: false,
  rankName: 'User',
  isDonor: false,
  contributed: 0n,
  consumed: 0n,
  statsVisible: true,
  ...over
});

// Tree under root 1:  1 → {2, 3};  2 → {4, 5};  4 → {6}
const rows = (): InviteTreeRow[] => [
  row(2, 1, { contributed: 100n, consumed: 50n }),
  row(3, 1, { contributed: 200n, consumed: 100n, isDonor: true }),
  row(4, 2, {
    contributed: 10n,
    consumed: 10n,
    rankName: 'Member',
    disabled: true
  }),
  row(5, 2, {
    contributed: 30n,
    consumed: 0n,
    rankName: 'Member',
    statsVisible: false
  }),
  row(6, 4, { contributed: 5n, consumed: 5n })
];

const flatten = (nodes: InviteTreeNode[]): InviteTreeNode[] =>
  nodes.flatMap((n) => [n, ...flatten(n.children)]);

describe('buildInviteSubtree', () => {
  it('nests descendants under the root with correct depth', () => {
    const tree = buildInviteSubtree(rows(), 1);
    expect(tree.map((n) => n.userId)).toEqual([2, 3]); // direct invitees
    expect(tree.every((n) => n.depth === 1)).toBe(true);

    const node2 = tree.find((n) => n.userId === 2)!;
    expect(node2.children.map((n) => n.userId)).toEqual([4, 5]);
    expect(node2.children.every((n) => n.depth === 2)).toBe(true);

    const node4 = node2.children.find((n) => n.userId === 4)!;
    expect(node4.children.map((n) => n.userId)).toEqual([6]);
    expect(node4.children[0].depth).toBe(3);
  });

  it('orders siblings by username', () => {
    const unsorted = [row(3, 1), row(2, 1), row(10, 1)]; // u3, u2, u10
    const tree = buildInviteSubtree(unsorted, 1);
    expect(tree.map((n) => n.username)).toEqual(['u10', 'u2', 'u3']);
  });

  it('returns an empty array for a leaf member with no invitees', () => {
    expect(buildInviteSubtree(rows(), 6)).toEqual([]);
  });

  it('carries per-node fields through, including the paranoia flag', () => {
    const node5 = flatten(buildInviteSubtree(rows(), 1)).find(
      (n) => n.userId === 5
    )!;
    expect(node5.statsVisible).toBe(false);
    expect(node5.contributed).toBe(30n);
    expect(node5.disabled).toBe(false);
  });

  it('guards against a cycle in corrupt data (no infinite recursion)', () => {
    // 1 → 2 → 3, and a back-edge re-pointing at an already-seen member.
    const corrupt = [row(2, 1), row(3, 2), row(2, 3)];
    const tree = buildInviteSubtree(corrupt, 1);
    expect(
      flatten(tree)
        .map((n) => n.userId)
        .sort()
    ).toEqual([2, 3]);
  });
});

describe('summarizeInviteTree', () => {
  const summary = () => summarizeInviteTree(buildInviteSubtree(rows(), 1));

  it('counts entries, branches, and depth', () => {
    const s = summary();
    expect(s.entries).toBe(5); // 2,3,4,5,6
    expect(s.branches).toBe(2); // direct invitees 2,3
    expect(s.depth).toBe(3); // member 6
  });

  it('counts disabled, donor, and paranoia-hidden members', () => {
    const s = summary();
    expect(s.disabledCount).toBe(1); // member 4
    expect(s.donorCount).toBe(1); // member 3
    expect(s.hiddenCount).toBe(1); // member 5
  });

  it('breaks down membership by rank, most common first', () => {
    expect(summary().byRank).toEqual([
      { rankName: 'User', count: 3 }, // 2,3,6
      { rankName: 'Member', count: 2 } // 4,5
    ]);
  });

  it('totals the whole subtree INCLUDING paranoia-hidden members', () => {
    // 100+200+10+30+5 = 345 contributed; 50+100+10+0+5 = 165 consumed
    expect(summary().total).toEqual({
      contributed: '345',
      consumed: '165',
      ratio: (345 / 165).toFixed(2)
    });
  });

  it('totals the top level (direct invitees) separately', () => {
    // members 2 + 3 only: 300 / 150
    expect(summary().topLevel).toEqual({
      contributed: '300',
      consumed: '150',
      ratio: '2.00'
    });
  });

  it('an empty tree summarizes to zeros (ratio defaults to 1.00)', () => {
    const s = summarizeInviteTree([]);
    expect(s.entries).toBe(0);
    expect(s.branches).toBe(0);
    expect(s.depth).toBe(0);
    expect(s.total).toEqual({ contributed: '0', consumed: '0', ratio: '1.00' });
  });
});
