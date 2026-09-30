import {
  truncateAll,
  seedDefaults,
  testPrisma,
  openRegistration
} from '../test/dbHelpers';
import { prisma } from '../lib/prisma';
import { createInvite } from '../modules/invite';

/**
 * Two invites to one new address at once (#822), against real rows. The
 * address check runs before the transaction, so the loser finds no row, then
 * meets the email key on insert. It must refuse as an already-invited address
 * does, spending nothing, rather than answer 500.
 */
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
  // DEFAULTS is `closed`; createInvite reads it (#673).
  await openRegistration();
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;
const mkInviter = async () => {
  seq += 1;
  const rank =
    (await testPrisma.userRank.findFirst({ where: { level: 100 } })) ??
    (await testPrisma.userRank.create({
      data: { level: 100, name: 'rank-100', permissions: {} }
    }));
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `it-race-${seq}`,
      email: `it-race-${seq}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      inviteCount: 1
    }
  });
};

const ADDRESS = 'friend@example.com';

describe('an invite that loses the race for a new address (#822)', () => {
  it('refuses as already invited and spends nothing', async () => {
    const [winner, loser] = [await mkInviter(), await mkInviter()];
    // The winner's invite, created after the loser checked the address.
    await testPrisma.invite.create({
      data: {
        inviterId: winner.id,
        inviteKey: 'winner-key',
        email: ADDRESS,
        expires: new Date(Date.now() + 3 * 86_400_000)
      }
    });
    jest
      .spyOn(prisma.invite, 'findUnique')
      .mockImplementationOnce((() => Promise.resolve(null)) as never);

    expect(await createInvite(loser.id, ADDRESS, '')).toEqual({
      ok: false,
      reason: 'already_invited'
    });

    const after = await testPrisma.user.findUniqueOrThrow({
      where: { id: loser.id }
    });
    expect(after.inviteCount).toBe(1);
    expect(await testPrisma.invite.count()).toBe(1);
  });
});
