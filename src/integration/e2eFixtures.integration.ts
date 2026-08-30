/**
 * The e2e content fixture against a real database (#339).
 *
 * What matters here is the wiring, not that `create` was called: a Contribution
 * needs an `editionId` and a `contributorId`, and getting either wrong produces
 * rows that exist but render wrong — invisible until someone runs Playwright
 * against a container stack. So these assert the actual graph, and that a second
 * run does not duplicate it, which is the guarantee the seeder's docstring makes.
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  seedE2eRelease,
  E2E_ARTIST_NAME,
  E2E_RELEASE_TITLE
} from '../modules/e2eFixtures';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;
const createUser = async () => {
  seq += 1;
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `user-${seq}-${Date.now()}`,
      email: `user-${seq}-${Date.now()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const createCommunity = async (name: string) =>
  testPrisma.community.create({
    data: {
      name,
      description: 'Integration fixture community.',
      image: '/images/defaults/music.png',
      registrationStatus: 'open',
      type: 'Music'
    }
  });

describe('seedE2eRelease', () => {
  it('plants a browsable release with a credit, an edition and a contribution', async () => {
    const community = await createCommunity('Fixture Community');
    const contributor = await createUser();

    const seeded = await seedE2eRelease(testPrisma, contributor.id);
    expect(seeded.communityId).toBe(community.id);

    const release = await testPrisma.release.findUniqueOrThrow({
      where: { id: seeded.releaseId },
      include: {
        credits: { include: { artist: true } },
        editions: true,
        contributions: true
      }
    });

    expect(release.title).toBe(E2E_RELEASE_TITLE);
    expect(release.communityId).toBe(community.id);
    // The Main credit is what `withPrimaryArtist` reads for the browse table's
    // artist column; without it the release lists with a blank artist.
    expect(release.credits).toHaveLength(1);
    expect(release.credits[0].role).toBe('Main');
    expect(release.credits[0].artist.name).toBe(E2E_ARTIST_NAME);
    expect(release.editions).toHaveLength(1);
    expect(release.contributions).toHaveLength(1);
  });

  it('attaches the contribution to this release’s own edition and contributor', async () => {
    await createCommunity('Fixture Community');
    const contributor = await createUser();

    const seeded = await seedE2eRelease(testPrisma, contributor.id);

    const contribution = await testPrisma.contribution.findUniqueOrThrow({
      where: { id: seeded.contributionId },
      include: { edition: true, contributor: true }
    });

    // The two foreign keys that are easiest to get wrong and hardest to notice.
    expect(contribution.edition.releaseId).toBe(seeded.releaseId);
    expect(contribution.contributor.userId).toBe(contributor.id);
    expect(contribution.userId).toBe(contributor.id);
  });

  it('is idempotent — a second run adds nothing', async () => {
    await createCommunity('Fixture Community');
    const contributor = await createUser();

    const first = await seedE2eRelease(testPrisma, contributor.id);
    const second = await seedE2eRelease(testPrisma, contributor.id);

    // Same rows, not new ones.
    expect(second).toEqual(first);
    expect(await testPrisma.release.count()).toBe(1);
    expect(await testPrisma.artist.count()).toBe(1);
    expect(await testPrisma.edition.count()).toBe(1);
    expect(await testPrisma.contribution.count()).toBe(1);
    expect(await testPrisma.contributor.count()).toBe(1);
  });

  it('refuses with an actionable message when no community exists', async () => {
    const contributor = await createUser();
    // The default community comes from POST /api/install, not `db:seed`, so
    // this is the realistic failure an operator hits and the message has to say
    // which step they skipped.
    await expect(seedE2eRelease(testPrisma, contributor.id)).rejects.toThrow(
      /\/install/
    );
  });
});
