/**
 * The chart's release scope, against a real database (#608, ADR-0036 §3).
 *
 * This file exists because of how #608 survived a release. `getTopReleases`
 * builds its ranking with `$queryRaw`, every unit spec mocks `$queryRaw`, and a
 * mock cannot fail on a column that does not exist — so three branches selected
 * and joined `releases."artistId"` for three months after #72 dropped it, and
 * nothing in the tree noticed. Every assertion here therefore goes through the
 * real query.
 *
 * It covers two rules at once, deliberately: that the query RUNS (the #608
 * regression), and that it ranks only releases in public communities (the
 * ADR-0036 §3 chart rule). A test for the second is worthless if the first
 * regresses, because both failures look like an empty chart.
 */

import {
  CommunityType,
  FileType,
  RegistrationStatus,
  ReleaseCategory,
  ReleaseType
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { getTopReleases } from '../modules/top10';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;
const tag = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;

const createUser = async (name: string) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: tag(name),
      email: `${tag(name)}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const createCommunity = (registrationStatus: RegistrationStatus) =>
  testPrisma.community.create({
    data: {
      name: tag(`T10-${registrationStatus}`),
      image: '',
      registrationStatus,
      type: CommunityType.Music
    }
  });

/**
 * A release with one contribution, so it can be ranked at all.
 *
 * `communityId: null` is a real case rather than a convenience — the column is
 * nullable, and a release belonging to no community was never private, which is
 * what the predicate's `IS NULL` arm exists for.
 */
const createRankableRelease = async (opts: {
  title: string;
  communityId: number | null;
  contributorId: number;
  contributorUserId: number;
  withArtist?: boolean;
}) => {
  const release = await testPrisma.release.create({
    data: {
      title: opts.title,
      description: 'desc',
      communityId: opts.communityId,
      type: ReleaseType.Music,
      releaseType: ReleaseCategory.Album,
      year: 2020,
      ...(opts.withArtist === false
        ? {}
        : {
            credits: {
              create: { artist: { create: { name: tag('T10-Artist') } } }
            }
          })
    }
  });
  const edition = await testPrisma.edition.create({
    data: { releaseId: release.id }
  });
  await testPrisma.contribution.create({
    data: {
      userId: opts.contributorUserId,
      releaseId: release.id,
      contributorId: opts.contributorId,
      editionId: edition.id,
      type: FileType.flac,
      downloadUrl: 'https://example.com/file.torrent',
      sizeInBytes: 1_000_000,
      approvedAccountingBytes: 1_000_000n,
      releaseDescription: 'test'
    }
  });
  return release;
};

/**
 * A contributor needs a community of its own, and that community is NOT the one
 * under test. The chart predicate reads `release."communityId"`; where the
 * CONTRIBUTOR belongs has no bearing on it, so this is deliberately always an
 * open one, leaving the release's own community the single variable.
 */
const createContributor = async (name: string) => {
  const user = await createUser(name);
  const home = await createCommunity(RegistrationStatus.open);
  const contributor = await testPrisma.contributor.create({
    data: { userId: user.id, communityId: home.id }
  });
  return { userId: user.id, contributorId: contributor.id };
};

/** A second contribution on an existing release, to move it up the ranking. */
const addContribution = async (
  releaseId: number,
  contributor: { userId: number; contributorId: number }
) => {
  const edition = await testPrisma.edition.create({ data: { releaseId } });
  return testPrisma.contribution.create({
    data: {
      userId: contributor.userId,
      releaseId,
      contributorId: contributor.contributorId,
      editionId: edition.id,
      type: FileType.flac,
      downloadUrl: 'https://example.com/second.torrent',
      sizeInBytes: 1_000_000,
      approvedAccountingBytes: 1_000_000n,
      releaseDescription: 'second'
    }
  });
};

const titlesIn = (items: Array<{ title: string }>) =>
  items.map((item) => item.title).sort();

describe('getTopReleases runs against a real database (#608)', () => {
  it('returns the credited artist rather than throwing on the dropped column', async () => {
    const contributor = await createContributor('t10');
    const community = await createCommunity(RegistrationStatus.open);
    await createRankableRelease({
      title: 'Kind of Blue',
      communityId: community.id,
      contributorUserId: contributor.userId,
      contributorId: contributor.contributorId
    });

    // Before #608 this threw `column r.artistId does not exist`, so the
    // assertion that matters most is simply that the call resolves.
    const items = await getTopReleases({ type: 'contributed', limit: 10 });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Kind of Blue');
    expect(items[0].artistName).toMatch(/^T10-Artist-/);
    expect(items[0].artistId).toBeGreaterThan(0);
    expect(items[0].rank).toBe(1);
  });

  it('does not let an uncredited release consume a ranking slot', async () => {
    const contributor = await createContributor('t10');
    const community = await createCommunity(RegistrationStatus.open);

    // The uncredited release outranks the credited one on contribution count,
    // so it sorts FIRST. That ordering is what makes this test able to fail.
    const credited = await createRankableRelease({
      title: 'Credited',
      communityId: community.id,
      contributorUserId: contributor.userId,
      contributorId: contributor.contributorId
    });
    const uncredited = await createRankableRelease({
      title: 'Uncredited',
      communityId: community.id,
      contributorUserId: contributor.userId,
      contributorId: contributor.contributorId,
      withArtist: false
    });
    await addContribution(uncredited.id, contributor);

    const items = await getTopReleases({ type: 'contributed', limit: 10 });

    // Membership alone cannot test the SQL guard: `attachArtists` yields no
    // artist for an uncredited release and the mapper drops it, so the title is
    // absent either way. The RANK is what distinguishes them — without the
    // EXISTS the uncredited release wins slot 1 and is then discarded, leaving
    // the credited release at rank 2 with nothing above it.
    expect(titlesIn(items)).toEqual(['Credited']);
    expect(items[0].releaseId).toBe(credited.id);
    expect(items[0].rank).toBe(1);
  });
});

describe('the chart ranks only public communities (ADR-0036 §3)', () => {
  it('includes open and community-less releases, excludes closed and invite', async () => {
    const contributor = await createContributor('t10');
    const open = await createCommunity(RegistrationStatus.open);
    const closed = await createCommunity(RegistrationStatus.closed);
    const invite = await createCommunity(RegistrationStatus.invite);

    await createRankableRelease({
      title: 'In Open',
      communityId: open.id,
      contributorUserId: contributor.userId,
      contributorId: contributor.contributorId
    });
    await createRankableRelease({
      title: 'In No Community',
      communityId: null,
      contributorUserId: contributor.userId,
      contributorId: contributor.contributorId
    });
    await createRankableRelease({
      title: 'In Closed',
      communityId: closed.id,
      contributorUserId: contributor.userId,
      contributorId: contributor.contributorId
    });
    await createRankableRelease({
      title: 'In Invite',
      communityId: invite.id,
      contributorUserId: contributor.userId,
      contributorId: contributor.contributorId
    });

    const items = await getTopReleases({ type: 'contributed', limit: 10 });

    expect(titlesIn(items)).toEqual(['In No Community', 'In Open']);
  });

  it('applies the same scope to every ranking branch', async () => {
    const contributor = await createContributor('t10');
    const open = await createCommunity(RegistrationStatus.open);
    const closed = await createCommunity(RegistrationStatus.closed);

    await createRankableRelease({
      title: 'Public',
      communityId: open.id,
      contributorUserId: contributor.userId,
      contributorId: contributor.contributorId
    });
    await createRankableRelease({
      title: 'Private',
      communityId: closed.id,
      contributorUserId: contributor.userId,
      contributorId: contributor.contributorId
    });

    // All three branches carried the same bug and take the same predicate, so
    // asserting only the one this suite happens to exercise first would leave
    // two thirds of the rule unmeasured. `consumed` and the windowed branches
    // rank off download grants and so return nothing here — which is the point:
    // they must RUN, and they must never surface the private release.
    for (const type of ['contributed', 'consumed', 'day', 'overall'] as const) {
      const items = await getTopReleases({ type, limit: 10 });
      expect(titlesIn(items)).not.toContain('Private');
    }

    expect(
      titlesIn(await getTopReleases({ type: 'contributed', limit: 10 }))
    ).toEqual(['Public']);
  });
});
