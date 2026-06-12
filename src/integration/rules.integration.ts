import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';

// PRD-05 #1 — the Rule/SubRule substrate against a real DB: round-trips the tree
// (the shape GET /api/rules/tree reads) and proves the cascade + uniqueness the
// migration declares. The pure scorer is covered in modules/ruleImpact.spec.ts.

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

// Mirrors the route's read query (orderBy + nested sub-rules).
const readTree = () =>
  testPrisma.rule.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { subRules: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } }
  });

describe('Rule/SubRule tree', () => {
  it('persists a CRS-weighted rule with nested sub-rules and reads it back', async () => {
    const rule = await testPrisma.rule.create({
      data: {
        code: 'golden.accounts',
        title: 'Accounts',
        description: 'One account per person per lifetime.',
        complianceWeight: 1,
        violationWeight: 5,
        sortOrder: 0,
        subRules: {
          create: [
            { code: 'no-sharing', title: 'No sharing', violationWeight: 3 },
            {
              code: 'keep-active',
              title: 'Keep it active',
              complianceWeight: 0.5
            }
          ]
        }
      }
    });

    const tree = await readTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(rule.id);
    expect(tree[0].violationWeight).toBe(5);
    expect(tree[0].subRules).toHaveLength(2);
    expect(tree[0].subRules.map((s) => s.code)).toEqual([
      'no-sharing',
      'keep-active'
    ]);
  });

  it('orders rules by sortOrder then id', async () => {
    await testPrisma.rule.create({
      data: { code: 'b', title: 'B', sortOrder: 1 }
    });
    await testPrisma.rule.create({
      data: { code: 'a', title: 'A', sortOrder: 0 }
    });

    const tree = await readTree();
    expect(tree.map((r) => r.code)).toEqual(['a', 'b']);
  });

  it('cascade-deletes sub-rules when the parent rule is removed', async () => {
    const rule = await testPrisma.rule.create({
      data: {
        code: 'golden.invites',
        title: 'Invites',
        subRules: { create: [{ code: 'no-trading', title: 'No trading' }] }
      }
    });

    await testPrisma.rule.delete({ where: { id: rule.id } });
    const orphans = await testPrisma.subRule.findMany();
    expect(orphans).toHaveLength(0);
  });

  it('rejects a duplicate sub-rule code within the same parent', async () => {
    const rule = await testPrisma.rule.create({
      data: {
        code: 'golden.conduct',
        title: 'Conduct',
        subRules: { create: [{ code: 'civil', title: 'Be civil' }] }
      }
    });

    await expect(
      testPrisma.subRule.create({
        data: { ruleId: rule.id, code: 'civil', title: 'Duplicate' }
      })
    ).rejects.toThrow();
  });
});
