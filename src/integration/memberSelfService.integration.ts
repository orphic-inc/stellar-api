/**
 * Integration coverage for the member self-service writes (#596 group 5).
 *
 * `ircNick.ts` (#829): an admin addresses `PUT /users/:id/irc-nick` by a path
 * id, and nothing reads that user before the write, so an id with no user
 * reaches `user.update` and must answer 404 rather than a raw P2025.
 *
 * `donor.ts` (#830): `updateDonorForumTitle` with an empty body is an upsert
 * with an empty `update`, which Prisma runs as read-then-insert rather than
 * `ON CONFLICT`. A first write racing another first write meets the unique
 * `userId`; the loser must still answer with the row.
 */
import { Prisma } from '@prisma/client';
import {
  truncateAll,
  seedDefaults,
  testPrisma,
  uniqueName
} from '../test/dbHelpers';
import { prisma } from '../lib/prisma';
import { claimIrcNick, clearIrcNick } from '../modules/ircNick';
import { updateDonorForumTitle } from '../modules/donor';

let rankId: number;

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
  rankId = (await testPrisma.userRank.findFirstOrThrow()).id;
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async (tag: string) => {
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const name = uniqueName(`ss-${tag}`);
  return testPrisma.user.create({
    data: {
      username: name,
      email: `${name}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rankId,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const missingUserId = async () => {
  const last = await testPrisma.user.findFirst({ orderBy: { id: 'desc' } });
  return (last?.id ?? 0) + 1000;
};

describe('ircNick — a path id with no user', () => {
  it('answers 404 when a claim addresses no user', async () => {
    await expect(
      claimIrcNick(await missingUserId(), 'nobody')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('answers 404 when a clear addresses no user', async () => {
    await expect(clearIrcNick(await missingUserId())).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('still opens a claim for a user who exists', async () => {
    const user = await createUser('nick');
    const result = await claimIrcNick(user.id, 'somenick');
    expect(result.alreadyVerified).toBe(false);
    const row = await testPrisma.user.findUniqueOrThrow({
      where: { id: user.id }
    });
    expect(row.pendingIrcNick).toBe('somenick');
  });
});

describe('updateDonorForumTitle — two first writes', () => {
  it('answers the winner’s row to an empty write that lost the insert', async () => {
    const user = await createUser('donor');
    const rank = await testPrisma.donorRank.create({
      data: {
        name: uniqueName('Donor'),
        minDonation: 1,
        perks: { forumTitle: true }
      }
    });
    await testPrisma.userDonorRank.create({
      data: { userId: user.id, donorRankId: rank.id }
    });

    // The winner inserts between the loser's read and its insert, so the
    // loser's insert meets the unique userId for real.
    jest.spyOn(prisma.donorForumUsername, 'upsert').mockImplementationOnce(((
      args: Prisma.DonorForumUsernameUpsertArgs
    ) =>
      testPrisma.donorForumUsername
        .create({
          data: { userId: user.id, prefix: 'Dr.', suffix: '', useComma: false }
        })
        .then(() =>
          testPrisma.donorForumUsername.create({
            data: args.create as Prisma.DonorForumUsernameUncheckedCreateInput
          })
        )) as never);

    await expect(updateDonorForumTitle(user.id, {})).resolves.toEqual({
      prefix: 'Dr.',
      suffix: '',
      useComma: false
    });
    expect(
      await testPrisma.donorForumUsername.count({ where: { userId: user.id } })
    ).toBe(1);
  });
});
