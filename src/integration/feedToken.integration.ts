/**
 * Integration coverage for the Member Feed token (ADR-0014, #262).
 *
 * What a mocked Prisma cannot vouch for: that `feedTokenEpoch` exists with its
 * default, that a rotation's increment really lands, that concurrent rotations
 * both count rather than one overwriting the other, and that the token an old
 * URL carries stops authenticating once it has.
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { feeds } from '../modules/config';
import {
  authenticateFeedOwner,
  deriveFeedToken,
  getMemberFeeds,
  rotateFeedToken
} from '../modules/feedToken';

const SECRET = feeds.secret;

beforeEach(async () => {
  feeds.secret = 'i'.repeat(32);
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  feeds.secret = SECRET;
  await testPrisma.$disconnect();
});

let seq = 0;
const mkUser = async (opts: { disabled?: boolean } = {}) => {
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
      username: `it-feed-${seq}`,
      email: `it-feed-${seq}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      disabled: opts.disabled ?? false
    }
  });
};

const epochOf = async (id: number) =>
  (await testPrisma.user.findUniqueOrThrow({ where: { id } })).feedTokenEpoch;

describe('Member Feed token against a real database', () => {
  it('starts every member at epoch 0, and authenticates that token', async () => {
    const member = await mkUser();

    expect(member.feedTokenEpoch).toBe(0);
    await expect(
      authenticateFeedOwner(member.id, deriveFeedToken(member.id, 0))
    ).resolves.toEqual({ id: member.id });
  });

  it('revokes the old URLs on rotation, and the answered URLs work', async () => {
    const member = await mkUser();
    const before = await getMemberFeeds(member.id);

    const after = await rotateFeedToken(member.id, member.id);

    expect(await epochOf(member.id)).toBe(1);
    await expect(
      authenticateFeedOwner(member.id, deriveFeedToken(member.id, 0))
    ).resolves.toBeNull();
    await expect(
      authenticateFeedOwner(member.id, deriveFeedToken(member.id, 1))
    ).resolves.toEqual({ id: member.id });
    expect(after).not.toEqual(before);
    expect(after.enabled && after.feeds.news).toContain(
      `token=${deriveFeedToken(member.id, 1)}`
    );
  });

  it('counts concurrent rotations, rather than letting one overwrite another', async () => {
    const member = await mkUser();

    await Promise.all([
      rotateFeedToken(member.id, member.id),
      rotateFeedToken(member.id, member.id),
      rotateFeedToken(member.id, member.id)
    ]);

    expect(await epochOf(member.id)).toBe(3);
  });

  it('writes one audit row per rotation, recording staff and reason', async () => {
    const staff = await mkUser();
    const member = await mkUser();

    await rotateFeedToken(staff.id, member.id, { reason: 'Leaked URL' });

    const rows = await testPrisma.auditLog.findMany({
      where: { action: 'user.feed_token_rotated', targetId: member.id }
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: staff.id,
      metadata: { self: false, reason: 'Leaked URL', messaged: false }
    });
  });

  it('refuses a disabled member even with their current token', async () => {
    const member = await mkUser({ disabled: true });

    await expect(
      authenticateFeedOwner(member.id, deriveFeedToken(member.id, 0))
    ).resolves.toBeNull();
  });

  it('answers 404 for a member that does not exist, and changes nothing', async () => {
    await expect(rotateFeedToken(1, 999999)).rejects.toMatchObject({
      statusCode: 404
    });
    expect(
      await testPrisma.auditLog.count({
        where: { action: 'user.feed_token_rotated' }
      })
    ).toBe(0);
  });
});
