/**
 * A contributor belongs to many communities, and an upload requires membership
 * (#709, ADR-0050).
 *
 * `Contributor` used to hold one `communityId` per user. The create path kept
 * the first community it saw and the add-to-release path moved the role to the
 * latest, so a member who uploaded to a second community lost the first. And
 * neither path checked access before writing the role, so uploading into a
 * private community made the uploader a member of it.
 */
import {
  CommunityType,
  FileType,
  RegistrationStatus,
  ReleaseType
} from '@prisma/client';
import {
  truncateAll,
  seedDefaults,
  testPrisma,
  uniqueName
} from '../test/dbHelpers';
import { drainBackgroundTasks } from '../modules/backgroundTasks';
import { createContributionSubmission } from '../modules/contribution';
import { hasCommunityAccess } from '../modules/communityAccess';
import { releaseWorkbench } from '../modules/releaseWorkbench';
import type {
  AddContributionToReleaseInput,
  CreateContributionInput
} from '../schemas/contribution';

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
  const name = uniqueName(`cm-${tag}`);
  return testPrisma.user.create({
    data: {
      username: name,
      email: `${name}@example.com`,
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
      name: uniqueName('CM-Community'),
      image: '',
      registrationStatus,
      type: CommunityType.Music
    }
  });

/** Admit a user the way a curator does today, before #709's role choice. */
const admitAsConsumer = (userId: number, communityId: number) =>
  testPrisma.consumer.upsert({
    where: { userId },
    create: { userId, communities: { connect: { id: communityId } } },
    update: { communities: { connect: { id: communityId } } }
  });

const newRelease = (communityId: number): CreateContributionInput => ({
  communityId,
  type: ReleaseType.Music,
  title: uniqueName('Album'),
  year: 1994,
  fileType: FileType.flac,
  downloadUrl: 'https://example.com/file.torrent',
  sizeInBytes: 1_000_000,
  tags: 'Shoegaze',
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
  collaborators: [{ artist: 'Slowdive', importance: 'main' }]
});

const attachment = (url: string): AddContributionToReleaseInput =>
  ({
    fileType: FileType.mp3,
    downloadUrl: url,
    sizeInBytes: 1_000_000,
    releaseDescription: 'desc'
  }) as AddContributionToReleaseInput;

/** The create path: a new release with its first contribution. */
const upload = async (userId: number, communityId: number) => {
  const c = await createContributionSubmission({
    userId,
    input: newRelease(communityId)
  });
  await drainBackgroundTasks();
  return c;
};

/** The add-to-release path, through the workbench the route opens. */
const attach = async (
  userId: number,
  communityId: number,
  releaseId: number
) => {
  const session = await releaseWorkbench.open({
    actorId: userId,
    communityId,
    releaseId,
    permissions: {}
  });
  const c = await session.attachContribution(
    attachment(`https://example.com/${uniqueName('a')}.torrent`)
  );
  await drainBackgroundTasks();
  return c;
};

const isMember = async (communityId: number, userId: number) =>
  hasCommunityAccess(communityId, userId, RegistrationStatus.closed);

describe('an upload requires membership (#709)', () => {
  it('refuses a non-member on the create path, and grants nothing', async () => {
    const outsider = await createUser('outsider');
    const closed = await createCommunity(RegistrationStatus.closed);

    await expect(upload(outsider.id, closed.id)).resolves.toBeNull();

    expect(await isMember(closed.id, outsider.id)).toBe(false);
    expect(
      await testPrisma.release.count({ where: { communityId: closed.id } })
    ).toBe(0);
  });

  it('refuses a non-member on the add-to-release path with a 404, and grants nothing', async () => {
    const member = await createUser('member');
    const outsider = await createUser('outsider');
    const closed = await createCommunity(RegistrationStatus.closed);
    await admitAsConsumer(member.id, closed.id);
    const first = await upload(member.id, closed.id);

    await expect(
      attach(outsider.id, closed.id, first!.release.id)
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(await isMember(closed.id, outsider.id)).toBe(false);
  });

  it('answers a non-member 404, not the duplicate-format 409, for a hidden release', async () => {
    // A 409 would confirm the release exists, and which file types it holds
    // (ADR-0036 §5). The duplicate check used to run before the gate.
    const member = await createUser('member');
    const outsider = await createUser('outsider');
    const closed = await testPrisma.community.create({
      data: {
        name: uniqueName('CM-NoDupes'),
        image: '',
        registrationStatus: RegistrationStatus.closed,
        type: CommunityType.Music,
        allowDuplicateFormats: false
      }
    });
    await admitAsConsumer(member.id, closed.id);
    const first = await upload(member.id, closed.id);

    const session = await releaseWorkbench.open({
      actorId: outsider.id,
      communityId: closed.id,
      releaseId: first!.release.id,
      permissions: {}
    });
    await expect(
      session.attachContribution({
        ...attachment('https://example.com/probe.torrent'),
        fileType: FileType.flac
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lets anyone upload to an open community, and records the role there', async () => {
    const uploader = await createUser('uploader');
    const open = await createCommunity(RegistrationStatus.open);

    await upload(uploader.id, open.id);

    const contributor = await testPrisma.contributor.findUniqueOrThrow({
      where: { userId: uploader.id },
      select: { communities: { select: { id: true } } }
    });
    expect(contributor.communities).toEqual([{ id: open.id }]);
  });
});

describe('a contributor belongs to every community they upload to (#709)', () => {
  it('keeps the first community when the create path uploads to a second', async () => {
    const uploader = await createUser('uploader');
    const a = await createCommunity(RegistrationStatus.closed);
    const c = await createCommunity(RegistrationStatus.open);
    await admitAsConsumer(uploader.id, a.id);
    await upload(uploader.id, a.id);
    // Admission was only the way in; drop it so the contributor role alone
    // has to carry membership of A from here on.
    await testPrisma.consumer.update({
      where: { userId: uploader.id },
      data: { communities: { disconnect: { id: a.id } } }
    });

    await upload(uploader.id, c.id);

    const contributor = await testPrisma.contributor.findUniqueOrThrow({
      where: { userId: uploader.id },
      select: { communities: { select: { id: true }, orderBy: { id: 'asc' } } }
    });
    expect(contributor.communities).toEqual([{ id: a.id }, { id: c.id }]);
    expect(await isMember(a.id, uploader.id)).toBe(true);
  });

  it('keeps the first community when the add-to-release path uploads to a second', async () => {
    const uploader = await createUser('uploader');
    const other = await createUser('other');
    const a = await createCommunity(RegistrationStatus.closed);
    const b = await createCommunity(RegistrationStatus.closed);
    await admitAsConsumer(other.id, b.id);
    const inB = await upload(other.id, b.id);

    await admitAsConsumer(uploader.id, a.id);
    await upload(uploader.id, a.id);
    await admitAsConsumer(uploader.id, b.id);
    await attach(uploader.id, b.id, inB!.release.id);
    // Drop both admissions so only the contributor role carries membership.
    await testPrisma.consumer.update({
      where: { userId: uploader.id },
      data: { communities: { set: [] } }
    });

    expect(await isMember(a.id, uploader.id)).toBe(true);
    expect(await isMember(b.id, uploader.id)).toBe(true);
  });
});
