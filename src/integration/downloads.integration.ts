import {
  FileType,
  ReleaseType,
  CommunityType,
  RegistrationStatus
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { grantDownloadAccess } from '../modules/downloads';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async (
  tag: string,
  overrides: {
    contributed?: bigint;
    consumed?: bigint;
    canDownload?: boolean;
  } = {}
) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `dl-${tag}-${Date.now()}`,
      email: `dl-${tag}-${Date.now()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      contributed: overrides.contributed ?? 0n,
      consumed: overrides.consumed ?? 0n,
      canDownload: overrides.canDownload ?? true
    }
  });
};

/** sizeInBytes is stored as Int in the schema; approvedAccountingBytes is BigInt. */
const createContribution = async (userId: number, sizeBytes = 1_000_000) => {
  const community = await testPrisma.community.create({
    data: {
      name: `DL-Community-${Date.now()}`,
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });
  const artist = await testPrisma.artist.create({
    data: { name: `DL-Artist-${Date.now()}` }
  });
  const release = await testPrisma.release.create({
    data: {
      artistId: artist.id,
      title: `DL-Release-${Date.now()}`,
      description: 'desc',
      type: ReleaseType.Music,
      releaseType: 'Album',
      year: 2020
    }
  });
  const contributor = await testPrisma.contributor.upsert({
    where: { userId },
    update: {},
    create: { userId, communityId: community.id }
  });
  return testPrisma.contribution.create({
    data: {
      userId,
      releaseId: release.id,
      contributorId: contributor.id,
      type: FileType.flac,
      downloadUrl: 'https://example.com/file.torrent',
      sizeInBytes: sizeBytes,
      approvedAccountingBytes: BigInt(sizeBytes),
      releaseDescription: 'test'
    }
  });
};

describe('grantDownloadAccess', () => {
  it('deducts from consumer balance and credits contributor on a successful grant', async () => {
    const COST = 1_000_000;
    const contributor = await createUser('contrib', { contributed: 0n });
    const consumer = await createUser('consumer', {
      contributed: BigInt(COST * 5)
    });
    const contribution = await createContribution(contributor.id, COST);

    const result = await grantDownloadAccess(consumer.id, contribution.id);

    expect(result.status).toBe('COMPLETED');
    expect(BigInt(result.amountBytes)).toBe(BigInt(COST));

    const updatedConsumer = await testPrisma.user.findUniqueOrThrow({
      where: { id: consumer.id }
    });
    expect(updatedConsumer.consumed).toBe(BigInt(COST));

    const updatedContributor = await testPrisma.user.findUniqueOrThrow({
      where: { id: contributor.id }
    });
    expect(updatedContributor.contributed).toBe(BigInt(COST));

    const grant = await testPrisma.downloadAccessGrant.findUnique({
      where: { id: result.grantId }
    });
    expect(grant).not.toBeNull();
    expect(grant!.amountBytes).toBe(BigInt(COST));
  });

  it('is idempotent within the 2-minute window — returns same grant without double charging', async () => {
    const COST = 500_000;
    const contributor = await createUser('contrib-idem', { contributed: 0n });
    const consumer = await createUser('consumer-idem', {
      contributed: BigInt(COST * 10)
    });
    const contribution = await createContribution(contributor.id, COST);

    const first = await grantDownloadAccess(consumer.id, contribution.id);
    const second = await grantDownloadAccess(consumer.id, contribution.id);

    expect(second.grantId).toBe(first.grantId);

    // Balance charged only once
    const updated = await testPrisma.user.findUniqueOrThrow({
      where: { id: consumer.id }
    });
    expect(updated.consumed).toBe(BigInt(COST));
  });

  it('rejects when consumer tries to download their own contribution', async () => {
    const user = await createUser('self', { contributed: BigInt(10_000_000) });
    const contribution = await createContribution(user.id);

    await expect(
      grantDownloadAccess(user.id, contribution.id)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects when consumer has insufficient balance', async () => {
    const COST = 5_000_000;
    const contributor = await createUser('contrib-low');
    const consumer = await createUser('consumer-low', { contributed: 100n });
    const contribution = await createContribution(contributor.id, COST);

    await expect(
      grantDownloadAccess(consumer.id, contribution.id)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects when canDownload is false', async () => {
    const COST = 1_000_000;
    const contributor = await createUser('contrib-ban');
    const consumer = await createUser('consumer-ban', {
      contributed: BigInt(COST * 5),
      canDownload: false
    });
    const contribution = await createContribution(contributor.id, COST);

    await expect(
      grantDownloadAccess(consumer.id, contribution.id)
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
