/**
 * A stat a member hides must not be derivable from the rest of their profile
 * (#723).
 *
 * Three fields gave a hidden stat back: the hidden dimension's own percentile
 * and rank, the Overall composite (every input percentile was public, so
 * dividing them out recovered the capped ratio), and `stats.buffer`, returned
 * when either side was visible.
 *
 * Against a real database, because `buildProfileView` fans out across a dozen
 * queries, and the bountySpent ranking is raw SQL a mock cannot exercise.
 */

import { CommunityType, RegistrationStatus, ReleaseType } from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { getProfileById } from '../modules/profile';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;
const tag = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;

const createUser = async (
  name: string,
  opts: {
    contributed?: bigint;
    consumed?: bigint;
    showContributedStats?: boolean;
    showConsumedStats?: boolean;
    showRatioStats?: boolean;
  } = {}
) => {
  const { contributed, consumed, ...settings } = opts;
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const userSettings = await testPrisma.userSettings.create({
    data: settings
  });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: tag(name),
      email: `${tag(name)}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: userSettings.id,
      profileId: profile.id,
      contributed,
      consumed
    }
  });
};

/** A request by `authorId` carrying a bounty of `amount` from `userId`. */
const stake = async (opts: {
  authorId: number;
  userId: number;
  amount: bigint;
  withdrawn?: boolean;
}) => {
  const community = await testPrisma.community.create({
    data: {
      name: tag('PSP'),
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });
  const request = await testPrisma.request.create({
    data: {
      communityId: community.id,
      userId: opts.authorId,
      title: tag('Wanted'),
      description: 'desc',
      type: ReleaseType.Music,
      deletedAt: opts.withdrawn ? new Date() : null
    }
  });
  await testPrisma.requestBounty.create({
    data: { requestId: request.id, userId: opts.userId, amount: opts.amount }
  });
};

type View = {
  stats: { contributed: string | null; buffer: string | null };
  percentiles: Record<
    string,
    { percentile: number; rank: number; raw: number } | number | null
  >;
};

const view = async (targetId: number, viewerId: number) =>
  (await getProfileById(targetId, viewerId, {
    showMature: false
  })) as unknown as View;

describe('GET /profile — hidden stats stay hidden (#723)', () => {
  it('nulls consumed, bountySpent, Overall and buffer when consumed is hidden', async () => {
    const target = await createUser('psp-target', {
      contributed: 3000n,
      consumed: 1000n,
      showConsumedStats: false
    });
    const stranger = await createUser('psp-stranger');
    await stake({ authorId: stranger.id, userId: target.id, amount: 200n });

    const seen = await view(target.id, stranger.id);

    expect(seen.percentiles.consumed).toBeNull();
    expect(seen.percentiles.bountySpent).toBeNull();
    expect(seen.percentiles.overall).toBeNull();
    expect(seen.stats.buffer).toBeNull();
    // The visible side stays visible.
    expect(seen.stats.contributed).toBe('3000');
    expect(seen.percentiles.contributed).toMatchObject({ raw: 3000 });
  });

  it('nulls buffer and Overall when contributed is hidden', async () => {
    const target = await createUser('psp-target', {
      contributed: 3000n,
      consumed: 1000n,
      showContributedStats: false
    });
    const stranger = await createUser('psp-stranger');

    const seen = await view(target.id, stranger.id);

    expect(seen.percentiles.contributed).toBeNull();
    expect(seen.percentiles.overall).toBeNull();
    expect(seen.stats.buffer).toBeNull();
  });

  it('nulls Overall alone when ratio is hidden', async () => {
    const target = await createUser('psp-target', {
      contributed: 3000n,
      consumed: 1000n,
      showRatioStats: false
    });
    const stranger = await createUser('psp-stranger');

    const seen = await view(target.id, stranger.id);

    expect(seen.percentiles.overall).toBeNull();
    expect(seen.percentiles.contributed).not.toBeNull();
    expect(seen.percentiles.consumed).not.toBeNull();
    expect(seen.stats.buffer).toBe('2000');
  });

  it('shows the owner everything, summing only live bounties', async () => {
    const target = await createUser('psp-target', {
      contributed: 3000n,
      consumed: 1000n,
      showContributedStats: false,
      showConsumedStats: false,
      showRatioStats: false
    });
    const other = await createUser('psp-other');
    await stake({ authorId: other.id, userId: target.id, amount: 200n });
    await stake({ authorId: other.id, userId: target.id, amount: 300n });
    await stake({
      authorId: other.id,
      userId: target.id,
      amount: 5000n,
      withdrawn: true
    });
    await stake({ authorId: target.id, userId: other.id, amount: 400n });

    const own = await view(target.id, target.id);

    // 200 + 300 live; the withdrawn request's 5000 does not count, which also
    // keeps the target (500) above `other` (400) rather than being inflated.
    expect(own.percentiles.bountySpent).toMatchObject({ raw: 500, rank: 1 });
    expect(own.percentiles.consumed).toMatchObject({ raw: 1000 });
    expect(typeof own.percentiles.overall).toBe('number');
    expect(own.stats.buffer).toBe('2000');
  });

  it('ranks a member below one who staked more', async () => {
    const target = await createUser('psp-target');
    const bigger = await createUser('psp-bigger');
    await stake({ authorId: bigger.id, userId: target.id, amount: 100n });
    await stake({ authorId: target.id, userId: bigger.id, amount: 900n });

    const own = await view(target.id, target.id);

    expect(own.percentiles.bountySpent).toMatchObject({ raw: 100, rank: 2 });
  });
});
