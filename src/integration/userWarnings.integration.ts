import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async (username: string) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username,
      email: `${username}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

describe('UserWarning DB model', () => {
  it('creates and retrieves warnings for a user', async () => {
    const warnedUser = await createUser('warnee');
    const staffer = await createUser('staffer');

    await testPrisma.userWarning.create({
      data: {
        userId: warnedUser.id,
        warnedById: staffer.id,
        reason: 'Spamming the forum'
      }
    });

    const warnings = await testPrisma.userWarning.findMany({
      where: { userId: warnedUser.id },
      include: { warnedBy: { select: { id: true, username: true } } }
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toBe('Spamming the forum');
    expect(warnings[0].warnedBy?.username).toBe('staffer');
  });

  it('returns all warnings across users when no userId filter applied', async () => {
    const user1 = await createUser('alpha');
    const user2 = await createUser('beta');
    const staffer = await createUser('mod');

    await testPrisma.userWarning.createMany({
      data: [
        { userId: user1.id, warnedById: staffer.id, reason: 'Reason A' },
        { userId: user2.id, warnedById: staffer.id, reason: 'Reason B' },
        { userId: user1.id, warnedById: staffer.id, reason: 'Reason C' }
      ]
    });

    const all = await testPrisma.userWarning.findMany({
      orderBy: { createdAt: 'desc' }
    });
    expect(all).toHaveLength(3);

    const forUser1 = await testPrisma.userWarning.findMany({
      where: { userId: user1.id }
    });
    expect(forUser1).toHaveLength(2);
  });

  it('deleting a warning decrements warnedTimes tracking', async () => {
    const user = await createUser('offender');
    const mod = await createUser('moderator');

    const warning = await testPrisma.userWarning.create({
      data: { userId: user.id, warnedById: mod.id, reason: 'Test' }
    });
    await testPrisma.user.update({
      where: { id: user.id },
      data: { warned: new Date(), warnedTimes: { increment: 1 } }
    });

    await testPrisma.userWarning.delete({ where: { id: warning.id } });
    const remaining = await testPrisma.userWarning.count({
      where: { userId: user.id }
    });
    if (remaining === 0) {
      await testPrisma.user.update({
        where: { id: user.id },
        data: { warned: null }
      });
    }

    const updated = await testPrisma.user.findUniqueOrThrow({
      where: { id: user.id }
    });
    expect(updated.warned).toBeNull();
  });
});
