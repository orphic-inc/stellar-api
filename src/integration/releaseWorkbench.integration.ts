import {
  ReleaseType,
  FileType,
  CommunityType,
  RegistrationStatus,
  Bitrate,
  ReleaseMedia
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { createContributionSubmission } from '../modules/contribution';
import { listReleaseContributions } from '../modules/releaseWorkbench/contributions';
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
      username: `rw-${tag}-${Date.now()}`,
      email: `rw-${tag}-${Date.now()}@example.com`,
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

// A lossless CD rip with a log + cue — every quality field set to a distinct,
// non-default value so the assertions fail if the read drops any of them.
const losslessInput = (communityId: number): CreateContributionInput => ({
  communityId,
  type: ReleaseType.Music,
  title: 'Kind of Blue',
  year: 1959,
  fileType: FileType.flac,
  downloadUrl: 'https://example.com/kob.torrent',
  sizeInBytes: 5_000_000_000,
  tags: 'jazz',
  releaseDescription: 'Lossless rip',
  image: undefined,
  description: undefined,
  bitrate: Bitrate.Lossless,
  media: ReleaseMedia.CD,
  releaseCategory: undefined,
  recordLabel: 'Columbia',
  catalogueNumber: 'CL 1355',
  editionTitle: 'Legacy Edition',
  editionYear: 1997,
  isRemaster: true,
  hasLog: true,
  hasCue: true,
  isScene: false,
  collaborators: [{ artist: 'Miles Davis', importance: 'main' }]
});

describe('listReleaseContributions', () => {
  it('returns each contribution with its rip-quality satellite and edition identity', async () => {
    const user = await createUser('quality');
    const community = await createCommunity();

    const created = await createContributionSubmission({
      userId: user.id,
      input: losslessInput(community.id)
    });
    expect(created).not.toBeNull();

    const contributions = await listReleaseContributions({
      actorId: user.id,
      communityId: community.id,
      releaseId: created!.releaseId
    });

    expect(contributions).toHaveLength(1);
    const entry = contributions[0];

    // Spine facts — format is the contribution type, size normalized to a number.
    expect(entry.type).toBe(FileType.flac);
    expect(entry.sizeInBytes).toBe(5_000_000_000);
    expect(entry.downloadUrl).toBe('https://example.com/kob.torrent');

    // Rip-quality satellite (ReleaseFile) — the whole point of #129.
    expect(entry.releaseFile).not.toBeNull();
    expect(entry.releaseFile?.bitrate).toBe(Bitrate.Lossless);
    expect(entry.releaseFile?.hasLog).toBe(true);
    expect(entry.releaseFile?.hasCue).toBe(true);
    expect(entry.releaseFile?.isScene).toBe(false);

    // Full edition identity — media plus the fields that build the edition string.
    expect(entry.edition?.media).toBe(ReleaseMedia.CD);
    expect(entry.edition?.recordLabel).toBe('Columbia');
    expect(entry.edition?.catalogueNumber).toBe('CL 1355');
    expect(entry.edition?.title).toBe('Legacy Edition');
    expect(entry.edition?.year).toBe(1997);
    expect(entry.edition?.isRemaster).toBe(true);
  });

  it('returns an empty array for a release with no contributions', async () => {
    const user = await createUser('empty');
    const community = await createCommunity();
    const release = await testPrisma.release.create({
      data: {
        title: 'Empty',
        description: 'no contributions',
        type: ReleaseType.Music,
        releaseType: 'Album',
        year: 2020,
        communityId: community.id
      }
    });

    const contributions = await listReleaseContributions({
      actorId: user.id,
      communityId: community.id,
      releaseId: release.id
    });

    expect(contributions).toEqual([]);
  });

  it('rejects a non-member of an invite-only community with 403', async () => {
    const owner = await createUser('owner');
    const outsider = await createUser('outsider');
    const community = await createCommunity();

    const created = await createContributionSubmission({
      userId: owner.id,
      input: losslessInput(community.id)
    });
    await testPrisma.community.update({
      where: { id: community.id },
      data: { registrationStatus: RegistrationStatus.invite }
    });

    await expect(
      listReleaseContributions({
        actorId: outsider.id,
        communityId: community.id,
        releaseId: created!.releaseId
      })
    ).rejects.toThrow(/member/i);
  });
});
