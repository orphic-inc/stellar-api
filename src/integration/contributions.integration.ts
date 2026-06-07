import {
  ReleaseType,
  FileType,
  CommunityType,
  RegistrationStatus
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  createContributionSubmission,
  addContributionToRelease
} from '../modules/contribution';
import type { CreateContributionInput } from '../schemas/contribution';

// Suppress the async link-health HTTP check — it fires and forgets after every
// contribution is created, and the pending outbound request holds a prisma
// connection that blocks the next test's TRUNCATE.
jest.mock('../modules/linkHealth', () => ({
  checkContributionLink: jest.fn().mockResolvedValue(undefined)
}));

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
      username: `contrib-${tag}-${Date.now()}`,
      email: `contrib-${tag}-${Date.now()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const createCommunity = () =>
  testPrisma.community.create({
    data: {
      name: `Community-${Date.now()}`,
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });

const baseInput = (communityId: number): CreateContributionInput => ({
  communityId,
  type: ReleaseType.Music,
  title: 'Test Album',
  year: 2020,
  fileType: FileType.flac,
  downloadUrl: 'https://example.com/file.torrent',
  sizeInBytes: 1_000_000,
  tags: 'rock, indie',
  releaseDescription: 'A great album',
  image: undefined,
  description: undefined,
  bitrate: undefined,
  media: undefined,
  hasLog: false,
  hasCue: false,
  isScene: false,
  collaborators: [{ artist: 'Test Artist', importance: 'main' }]
});

describe('createContributionSubmission', () => {
  it('creates artist, release, contributor, and contribution in one transaction', async () => {
    const user = await createUser('a');
    const community = await createCommunity();

    const result = await createContributionSubmission({
      userId: user.id,
      input: baseInput(community.id)
    });

    expect(result).not.toBeNull();
    expect(result!.userId).toBe(user.id);
    expect(result!.release.communityId).toBe(community.id);
    expect(result!.collaborators).toHaveLength(1);
    expect(result!.collaborators[0].name).toBe('Test Artist');

    const artist = await testPrisma.artist.findFirst({
      where: { name: 'Test Artist' }
    });
    expect(artist).not.toBeNull();

    const release = await testPrisma.release.findUnique({
      where: { id: result!.releaseId }
    });
    expect(release).not.toBeNull();
    expect(release!.title).toBe('Test Album');
    expect(release!.communityId).toBe(community.id);

    const contributor = await testPrisma.contributor.findUnique({
      where: { userId: user.id }
    });
    expect(contributor).not.toBeNull();
  });

  it('stores file sizes larger than INT4 max (>2 GiB) without overflow', async () => {
    const user = await createUser('big');
    const community = await createCommunity();

    // 1_040_503_013_376 = 992301 MB * 1048576 — well past INT4 max (2_147_483_647).
    // Lossless discographies routinely exceed 2 GiB, so sizeInBytes must be 64-bit.
    const bigSize = 1_040_503_013_376;

    const result = await createContributionSubmission({
      userId: user.id,
      input: { ...baseInput(community.id), sizeInBytes: bigSize }
    });

    expect(result).not.toBeNull();
    // Contract: sizeInBytes is returned as a JS number (safe < 2^53), not a string.
    expect(result!.sizeInBytes).toBe(bigSize);

    const persisted = await testPrisma.contribution.findUnique({
      where: { id: result!.id },
      select: { sizeInBytes: true }
    });
    expect(persisted!.sizeInBytes).toBe(BigInt(bigSize));
  });

  it('reuses an existing artist rather than creating a duplicate', async () => {
    const user = await createUser('b');
    const community = await createCommunity();

    await testPrisma.artist.create({ data: { name: 'Shared Artist' } });

    await createContributionSubmission({
      userId: user.id,
      input: {
        ...baseInput(community.id),
        collaborators: [{ artist: 'Shared Artist', importance: 'main' }]
      }
    });

    const count = await testPrisma.artist.count({
      where: { name: 'Shared Artist' }
    });
    expect(count).toBe(1);
  });

  it('returns null when the community does not exist', async () => {
    const user = await createUser('c');

    const result = await createContributionSubmission({
      userId: user.id,
      input: baseInput(999_999)
    });

    expect(result).toBeNull();
  });

  it('persists tags and increments tag occurrence counts', async () => {
    const user = await createUser('d');
    const community = await createCommunity();

    await createContributionSubmission({
      userId: user.id,
      input: { ...baseInput(community.id), tags: 'jazz, fusion' }
    });

    const jazz = await testPrisma.tag.findUnique({ where: { name: 'jazz' } });
    expect(jazz).not.toBeNull();
    expect(jazz!.occurrences).toBeGreaterThanOrEqual(1);
  });
});

describe('addContributionToRelease', () => {
  it('adds a second contribution to an existing release', async () => {
    const owner = await createUser('e');
    const contributor = await createUser('f');
    const community = await createCommunity();

    const first = await createContributionSubmission({
      userId: owner.id,
      input: baseInput(community.id)
    });
    expect(first).not.toBeNull();

    const result = await addContributionToRelease({
      userId: contributor.id,
      communityId: community.id,
      releaseId: first!.releaseId,
      input: {
        fileType: FileType.mp3,
        downloadUrl: 'https://example.com/mp3.torrent',
        sizeInBytes: 200_000,
        releaseDescription: 'MP3 version',
        bitrate: undefined,
        media: undefined,
        hasLog: false,
        hasCue: false,
        isScene: false
      }
    });

    expect(result).not.toBeNull();
    expect(result!.releaseId).toBe(first!.releaseId);
    expect(result!.userId).toBe(contributor.id);

    const contributions = await testPrisma.contribution.findMany({
      where: { releaseId: first!.releaseId }
    });
    expect(contributions).toHaveLength(2);
  });

  it('returns null when the release does not belong to the given community', async () => {
    const user = await createUser('g');
    const communityA = await createCommunity();
    const communityB = await createCommunity();

    const first = await createContributionSubmission({
      userId: user.id,
      input: baseInput(communityA.id)
    });
    expect(first).not.toBeNull();

    const result = await addContributionToRelease({
      userId: user.id,
      communityId: communityB.id,
      releaseId: first!.releaseId,
      input: {
        fileType: FileType.flac,
        downloadUrl: 'https://example.com/other.torrent',
        releaseDescription: undefined,
        bitrate: undefined,
        media: undefined,
        hasLog: false,
        hasCue: false,
        isScene: false
      }
    });

    expect(result).toBeNull();
  });
});
