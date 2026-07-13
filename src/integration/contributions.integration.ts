import {
  ReleaseType,
  FileType,
  CommunityType,
  RegistrationStatus,
  RatioExempt
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  createContributionSubmission,
  addContributionToRelease,
  setContributionRatioExempt
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
  releaseCategory: undefined,
  recordLabel: undefined,
  catalogueNumber: undefined,
  editionTitle: undefined,
  editionYear: undefined,
  isRemaster: false,
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

    // 5_000_000_000 (5 GB) — well past INT4 max (2_147_483_647) so it proves
    // 64-bit storage, while staying under the 20 GB Music contribution cap (#93).
    // Lossless discographies routinely exceed 2 GiB, so sizeInBytes must be 64-bit.
    const bigSize = 5_000_000_000;

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

  it('sets the release category from input rather than defaulting to Album', async () => {
    const user = await createUser('cat');
    const community = await createCommunity();

    const result = await createContributionSubmission({
      userId: user.id,
      input: { ...baseInput(community.id), releaseCategory: 'EP' }
    });

    const release = await testPrisma.release.findUnique({
      where: { id: result!.releaseId }
    });
    expect(release!.releaseType).toBe('EP');
  });

  it('defaults the release category to Album for Music when omitted', async () => {
    const user = await createUser('catdef');
    const community = await createCommunity();

    const result = await createContributionSubmission({
      userId: user.id,
      input: baseInput(community.id)
    });

    const release = await testPrisma.release.findUnique({
      where: { id: result!.releaseId }
    });
    expect(release!.releaseType).toBe('Album');
  });

  it('persists edition metadata and marks the edition as known', async () => {
    const user = await createUser('ed');
    const community = await createCommunity();

    const result = await createContributionSubmission({
      userId: user.id,
      input: {
        ...baseInput(community.id),
        recordLabel: 'Blue Note',
        catalogueNumber: 'BN-1577',
        editionTitle: '24-bit Remaster',
        editionYear: 2015,
        isRemaster: true
      }
    });

    const edition = await testPrisma.edition.findFirst({
      where: { releaseId: result!.releaseId }
    });
    expect(edition!.recordLabel).toBe('Blue Note');
    expect(edition!.catalogueNumber).toBe('BN-1577');
    expect(edition!.title).toBe('24-bit Remaster');
    expect(edition!.year).toBe(2015);
    expect(edition!.isRemaster).toBe(true);
    expect(edition!.isUnknownEdition).toBe(false);
  });

  it('leaves the edition unknown when no edition metadata is supplied', async () => {
    const user = await createUser('edu');
    const community = await createCommunity();

    const result = await createContributionSubmission({
      userId: user.id,
      input: baseInput(community.id)
    });

    const edition = await testPrisma.edition.findFirst({
      where: { releaseId: result!.releaseId }
    });
    expect(edition!.isUnknownEdition).toBe(true);
    expect(edition!.recordLabel).toBeNull();
  });

  it('creates one credit per collaborator with its mapped role', async () => {
    const user = await createUser('roles');
    const community = await createCommunity();

    const result = await createContributionSubmission({
      userId: user.id,
      input: {
        ...baseInput(community.id),
        collaborators: [
          { artist: 'Lead Singer', importance: 'Main artist' },
          { artist: 'Featured Guest', importance: 'Guest artist' },
          { artist: 'The Remixer', importance: 'Remixer' }
        ]
      }
    });

    const credits = await testPrisma.releaseArtist.findMany({
      where: { releaseId: result!.releaseId },
      include: { artist: true }
    });
    expect(credits).toHaveLength(3);
    const roleByName = Object.fromEntries(
      credits.map((c) => [c.artist.name, c.role])
    );
    expect(roleByName['Lead Singer']).toBe('Main');
    expect(roleByName['Featured Guest']).toBe('Guest');
    expect(roleByName['The Remixer']).toBe('Remixer');
  });

  it('rejects a contribution above the per-type size cap before touching the DB (#93)', async () => {
    const user = await createUser('toobig');
    const community = await createCommunity();

    // baseInput is a Music release; the Music ceiling is 20 GB.
    await expect(
      createContributionSubmission({
        userId: user.id,
        input: {
          ...baseInput(community.id),
          sizeInBytes: 20_000_000_001
        }
      })
    ).rejects.toThrow(/limit for Music/);

    const contributions = await testPrisma.contribution.count();
    expect(contributions).toBe(0);
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

  it('rejects an oversized file using the release type, not the request body (#93)', async () => {
    const owner = await createUser('cap-owner');
    const contributor = await createUser('cap-contrib');
    const community = await createCommunity();

    // The release is Music (baseInput), so the 20 GB Music cap applies even
    // though this path carries no `type` in the body.
    const first = await createContributionSubmission({
      userId: owner.id,
      input: baseInput(community.id)
    });
    expect(first).not.toBeNull();

    await expect(
      addContributionToRelease({
        userId: contributor.id,
        communityId: community.id,
        releaseId: first!.releaseId,
        input: {
          fileType: FileType.flac,
          downloadUrl: 'https://example.com/huge.torrent',
          sizeInBytes: 20_000_000_001,
          releaseDescription: undefined,
          bitrate: undefined,
          media: undefined,
          hasLog: false,
          hasCue: false,
          isScene: false
        }
      })
    ).rejects.toThrow(/limit for Music/);

    // The original contribution is untouched; no second row was created.
    const contributions = await testPrisma.contribution.count({
      where: { releaseId: first!.releaseId }
    });
    expect(contributions).toBe(1);
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

describe('setContributionRatioExempt', () => {
  it('sets the flag and writes an audit row', async () => {
    const staff = await createUser('rx-staff');
    const owner = await createUser('rx-owner');
    const community = await createCommunity();
    const contribution = await createContributionSubmission({
      userId: owner.id,
      input: baseInput(community.id)
    });

    const updated = await setContributionRatioExempt(
      staff.id,
      contribution!.id,
      RatioExempt.FREEPASS
    );
    expect(updated.ratioExempt).toBe(RatioExempt.FREEPASS);

    const row = await testPrisma.contribution.findUniqueOrThrow({
      where: { id: contribution!.id }
    });
    expect(row.ratioExempt).toBe(RatioExempt.FREEPASS);

    const auditRow = await testPrisma.auditLog.findFirst({
      where: {
        action: 'contribution.ratio_exempt.set',
        targetId: contribution!.id
      }
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow!.actorId).toBe(staff.id);
  });

  it('is a no-op that writes no audit row when the flag is unchanged', async () => {
    const staff = await createUser('rx-noop-staff');
    const owner = await createUser('rx-noop-owner');
    const community = await createCommunity();
    const contribution = await createContributionSubmission({
      userId: owner.id,
      input: baseInput(community.id)
    });

    // Default is NONE; setting NONE again should not audit.
    await setContributionRatioExempt(
      staff.id,
      contribution!.id,
      RatioExempt.NONE
    );

    const auditRows = await testPrisma.auditLog.findMany({
      where: {
        action: 'contribution.ratio_exempt.set',
        targetId: contribution!.id
      }
    });
    expect(auditRows).toHaveLength(0);
  });
});
