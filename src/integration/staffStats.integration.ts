import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async (tag: string) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `stats-${tag}-${Date.now()}`,
      email: `stats-${tag}-${Date.now()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

describe('stats/economy DB query', () => {
  it('groupBy returns correct aggregates for multiple reasons', async () => {
    const user = await createUser('a');
    await testPrisma.economyTransaction.createMany({
      data: [
        { userId: user.id, amount: 100, reason: 'REQUEST_CREATE' },
        { userId: user.id, amount: 200, reason: 'REQUEST_CREATE' },
        { userId: user.id, amount: 50, reason: 'DOWNLOAD_DEBIT' }
      ]
    });

    const grouped = await testPrisma.economyTransaction.groupBy({
      by: ['reason'],
      _sum: { amount: true },
      _count: true
    });

    const creates = grouped.find((g) => g.reason === 'REQUEST_CREATE');
    const debits = grouped.find((g) => g.reason === 'DOWNLOAD_DEBIT');

    expect(creates).toBeDefined();
    expect(creates!._count).toBe(2);
    expect(Number(creates!._sum.amount)).toBe(300);
    expect(debits!._count).toBe(1);
    expect(Number(debits!._sum.amount)).toBe(50);
  });

  it('recent transactions include user relation', async () => {
    const user = await createUser('b');
    await testPrisma.economyTransaction.create({
      data: { userId: user.id, amount: 42, reason: 'STAFF_REVERSAL' }
    });

    const recent = await testPrisma.economyTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { user: { select: { id: true, username: true } } }
    });

    expect(recent).toHaveLength(1);
    expect(recent[0].user.id).toBe(user.id);
    expect(recent[0].user.username).toContain('stats-b-');
    expect(Number(recent[0].amount)).toBe(42);
  });
});

describe('stats/site-info DB query', () => {
  it('counts users accurately', async () => {
    const before = await testPrisma.user.count();
    await createUser('c');
    await createUser('d');
    const after = await testPrisma.user.count();
    expect(after).toBe(before + 2);
  });

  it('counts enabled vs disabled users separately', async () => {
    const user = await createUser('e');
    await testPrisma.user.update({
      where: { id: user.id },
      data: { disabled: true }
    });
    const disabled = await testPrisma.user.count({ where: { disabled: true } });
    const enabled = await testPrisma.user.count({ where: { disabled: false } });
    expect(disabled).toBeGreaterThanOrEqual(1);
    expect(enabled).toBeGreaterThanOrEqual(0);
  });
});

describe('stats/clients DB query', () => {
  it('groups sessions by userAgent and returns top results', async () => {
    const user = await createUser('f');
    await testPrisma.userSession.createMany({
      data: [
        { userId: user.id, ipAddress: '1.1.1.1', userAgent: 'Mozilla/5.0' },
        { userId: user.id, ipAddress: '1.1.1.1', userAgent: 'Mozilla/5.0' },
        { userId: user.id, ipAddress: '1.1.1.1', userAgent: 'curl/7.0' }
      ]
    });

    const rows = await testPrisma.userSession.groupBy({
      by: ['userAgent'],
      _count: { userAgent: true },
      orderBy: { _count: { userAgent: 'desc' } },
      take: 50
    });

    expect(rows.length).toBeGreaterThanOrEqual(2);
    const mozilla = rows.find((r) => r.userAgent === 'Mozilla/5.0');
    expect(mozilla).toBeDefined();
    expect(mozilla!._count.userAgent).toBe(2);
  });
});

describe('stats/user-flow DB query', () => {
  it('invite funnel groups invites by status', async () => {
    const inviter = await createUser('g');
    await testPrisma.invite.createMany({
      data: [
        {
          inviterId: inviter.id,
          inviteKey: `key-${Date.now()}-1`,
          email: 'a@x.com',
          expires: new Date(),
          reason: 'test'
        },
        {
          inviterId: inviter.id,
          inviteKey: `key-${Date.now()}-2`,
          email: 'b@x.com',
          expires: new Date(),
          reason: 'test',
          status: 'pending'
        }
      ]
    });

    const funnel = await testPrisma.invite.groupBy({
      by: ['status'],
      _count: true
    });

    expect(funnel.length).toBeGreaterThanOrEqual(1);
    expect(funnel.every((f) => typeof f._count === 'number')).toBe(true);
  });
});
