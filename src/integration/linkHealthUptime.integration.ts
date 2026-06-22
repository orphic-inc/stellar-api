import {
  ReleaseType,
  FileType,
  CommunityType,
  RegistrationStatus,
  LinkHealthStatus
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { createContributionSubmission } from '../modules/contribution';
import type { CreateContributionInput } from '../schemas/contribution';

// Stub the fire-and-forget HTTP check that createContributionSubmission triggers
// (it would hit the network and hold a connection across the next TRUNCATE). We
// drive the uptime columns directly below to exercise the read path (#95).
jest.mock('../modules/linkHealth', () => ({
  ...jest.requireActual('../modules/linkHealth'),
  checkContributionLink: jest.fn().mockResolvedValue(undefined)
}));
import { getReputation } from '../modules/reputation';

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

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
  const tag = `lhu-${seq}-${Date.now()}`;
  const [rank, settings, profile] = await Promise.all([
    testPrisma.userRank.findFirstOrThrow(),
    testPrisma.userSettings.create({ data: {} }),
    testPrisma.profile.create({ data: {} })
  ]);
  return testPrisma.user.create({
    data: {
      username: tag,
      email: `${tag}@example.com`,
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
      name: `Community-${Date.now()}-${seq}`,
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });

const baseInput = (
  communityId: number,
  title: string
): CreateContributionInput => ({
  communityId,
  type: ReleaseType.Music,
  title,
  year: 2020,
  fileType: FileType.flac,
  downloadUrl: 'https://example.com/file.torrent',
  sizeInBytes: 1_000_000,
  tags: 'rock',
  releaseDescription: 'desc',
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

describe('lifetime link-health dimension (integration, #95)', () => {
  it('reads banked confirmed-PASS uptime into the linkHealth CRS dimension', async () => {
    const user = await createUser();
    const community = await createCommunity();
    const contribution = await createContributionSubmission({
      userId: user.id,
      input: baseInput(community.id, 'Long-Lived Album')
    });
    if (!contribution) throw new Error('fixture contribution failed');

    // A 2-year-old contribution that banked the full 2 years of confirmed PASS
    // (segment closed). Round-trips the BigInt healthyMs column through Postgres.
    await testPrisma.contribution.update({
      where: { id: contribution.id },
      data: {
        createdAt: new Date(Date.now() - 2 * YEAR_MS),
        linkStatus: LinkHealthStatus.FAIL,
        healthyMs: BigInt(Math.round(2 * YEAR_MS)),
        healthySince: null
      }
    });

    const crs = await getReputation(user.id);
    const linkHealth = crs.dimensions.find((d) => d.name === 'linkHealth');
    expect(linkHealth).toBeDefined();
    // R ≈ 1 over a 2y life, H ≈ 2 link-years → cap 8 · (1 − e^(−2/3)) ≈ 3.9.
    expect(linkHealth!.subScore).toBeGreaterThan(3);
    expect(linkHealth!.subScore).toBeLessThanOrEqual(8);
  });

  it('gives a fresh, never-confirmed contribution ~zero link-health', async () => {
    const user = await createUser();
    const community = await createCommunity();
    const contribution = await createContributionSubmission({
      userId: user.id,
      input: baseInput(community.id, 'Brand New Album')
    });
    if (!contribution) throw new Error('fixture contribution failed');

    // Default columns: healthyMs 0, healthySince null, UNKNOWN — nothing banked.
    const crs = await getReputation(user.id);
    const linkHealth = crs.dimensions.find((d) => d.name === 'linkHealth');
    expect(linkHealth!.subScore).toBe(0);
  });
});
