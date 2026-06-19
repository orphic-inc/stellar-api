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

// Partial-mock: keep the real sweepStaleWarnLinks under test, but stub the
// fire-and-forget HTTP check that createContributionSubmission triggers (it would
// hit the network and hold a connection across the next TRUNCATE).
jest.mock('../modules/linkHealth', () => ({
  ...jest.requireActual('../modules/linkHealth'),
  checkContributionLink: jest.fn().mockResolvedValue(undefined)
}));
import { sweepStaleWarnLinks } from '../modules/linkHealth';

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
  const tag = `lh-${seq}-${Date.now()}`;
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

const makeStuckWarn = async (
  userId: number,
  communityId: number,
  title: string
) => {
  const contribution = await createContributionSubmission({
    userId,
    input: baseInput(communityId, title)
  });
  if (!contribution) throw new Error('fixture contribution failed');
  await testPrisma.contribution.update({
    where: { id: contribution.id },
    data: {
      linkStatus: LinkHealthStatus.WARN,
      linkStatusChangedAt: new Date(Date.now() - 80 * 60 * 60 * 1000) // 80h > 72h
    }
  });
  return contribution.id;
};

describe('sweepStaleWarnLinks (integration)', () => {
  it('promotes a stuck WARN link to FAIL and PMs the contributor from System', async () => {
    const user = await createUser();
    const community = await createCommunity();
    const contributionId = await makeStuckWarn(
      user.id,
      community.id,
      'Dead Link Album'
    );

    await sweepStaleWarnLinks();

    const after = await testPrisma.contribution.findUniqueOrThrow({
      where: { id: contributionId }
    });
    expect(after.linkStatus).toBe(LinkHealthStatus.FAIL);

    // The contributor has a conversation whose only message has a null sender
    // (the "System" notice) and names the dead release.
    const participant =
      await testPrisma.privateConversationParticipant.findFirst({
        where: { userId: user.id }
      });
    expect(participant).not.toBeNull();

    const message = await testPrisma.privateMessage.findFirstOrThrow({
      where: { conversationId: participant!.conversationId }
    });
    expect(message.senderId).toBeNull();
    expect(message.body).toContain('Dead Link Album');
  });

  it('leaves a recently-WARNed link alone and sends no PM', async () => {
    const user = await createUser();
    const community = await createCommunity();
    const contribution = await createContributionSubmission({
      userId: user.id,
      input: baseInput(community.id, 'Fresh Warn')
    });
    // WARNed just now — inside the 72h window.
    await testPrisma.contribution.update({
      where: { id: contribution!.id },
      data: {
        linkStatus: LinkHealthStatus.WARN,
        linkStatusChangedAt: new Date()
      }
    });

    await sweepStaleWarnLinks();

    const after = await testPrisma.contribution.findUniqueOrThrow({
      where: { id: contribution!.id }
    });
    expect(after.linkStatus).toBe(LinkHealthStatus.WARN);
    const convCount = await testPrisma.privateConversation.count();
    expect(convCount).toBe(0);
  });
});
