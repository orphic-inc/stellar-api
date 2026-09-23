/**
 * Integration coverage for contribution notification filters (#263, ADR-0049).
 *
 * The claims here are about the database: that a real upload through either
 * contribution path lands hits after commit, that the array pre-filter and the
 * access check leave out who they should, that `newReleasesOnly` reads a
 * release's earlier contributions, and that the member-facing count and list
 * work per contribution while each filter keeps its own rows.
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
import {
  addContributionToRelease,
  createContributionSubmission
} from '../modules/contribution';
import {
  catchUpNotificationFilterHits,
  clearReadNotificationFilterHits,
  countUnreadNotificationFilterHits,
  listNotificationFilterHits,
  markNotificationFilterHitRead
} from '../modules/notificationFilters';
import type { CreateContributionInput } from '../schemas/contribution';

// The link check fires after every contribution too; keep it off the network.
jest.mock('../modules/linkHealth', () => ({
  checkContributionLink: jest.fn().mockResolvedValue(undefined)
}));

let rankId: number;

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
  const rank = await testPrisma.userRank.findFirstOrThrow();
  rankId = rank.id;
  await testPrisma.userRank.update({
    where: { id: rankId },
    data: { notificationFilterLimit: null }
  });
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async (tag: string) => {
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const name = uniqueName(`nf-${tag}`);
  return testPrisma.user.create({
    data: {
      username: name,
      email: `${name}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rankId,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const createCommunity = (
  registrationStatus: RegistrationStatus = RegistrationStatus.open
) =>
  testPrisma.community.create({
    data: {
      name: uniqueName('NF-Community'),
      image: '',
      registrationStatus,
      type: CommunityType.Music
    }
  });

const input = (
  communityId: number,
  over: Partial<CreateContributionInput> = {}
): CreateContributionInput => ({
  communityId,
  type: ReleaseType.Music,
  title: uniqueName('Album'),
  year: 1994,
  fileType: FileType.flac,
  downloadUrl: 'https://example.com/file.torrent',
  sizeInBytes: 1_000_000,
  tags: 'Shoegaze, Dream Pop',
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
  collaborators: [{ artist: 'Slowdive', importance: 'main' }],
  ...over
});

/** Upload, then wait for the post-commit matcher. */
const upload = async (
  userId: number,
  communityId: number,
  over: Partial<CreateContributionInput> = {}
) => {
  const c = await createContributionSubmission({
    userId,
    input: input(communityId, over)
  });
  await drainBackgroundTasks();
  return c!;
};

const watch = (userId: number, over: Record<string, unknown> = {}) =>
  testPrisma.notificationFilter.create({
    data: { userId, label: 'watch', tags: ['shoegaze'], ...over }
  });

const hitsOf = (userId: number) =>
  testPrisma.notificationFilterHit.findMany({
    where: { userId },
    orderBy: [{ id: 'asc' }]
  });

describe('matching on upload', () => {
  it('lands a hit after commit, on canonical tag names', async () => {
    const uploader = await createUser('up');
    const watcher = await createUser('w');
    const community = await createCommunity();
    const filter = await watch(watcher.id);

    const c = await upload(uploader.id, community.id);

    expect(await hitsOf(watcher.id)).toEqual([
      expect.objectContaining({
        filterId: filter.id,
        contributionId: c.id,
        readAt: null
      })
    ]);
  });

  it('does not notify the uploader of their own contribution', async () => {
    const uploader = await createUser('up');
    const community = await createCommunity();
    await watch(uploader.id);

    await upload(uploader.id, community.id);

    expect(await hitsOf(uploader.id)).toEqual([]);
  });

  it('leaves out a disabled account, and a rank with no allowance', async () => {
    const uploader = await createUser('up');
    const disabled = await createUser('off');
    const closedRank = await createUser('rank0');
    const community = await createCommunity();
    await testPrisma.user.update({
      where: { id: disabled.id },
      data: { disabled: true }
    });
    const zero = await testPrisma.userRank.create({
      data: {
        level: 7,
        name: 'NoFilters',
        permissions: {},
        notificationFilterLimit: 0
      }
    });
    await testPrisma.user.update({
      where: { id: closedRank.id },
      data: { userRankId: zero.id }
    });
    await watch(disabled.id);
    await watch(closedRank.id);

    await upload(uploader.id, community.id);

    expect(await testPrisma.notificationFilterHit.count()).toBe(0);
  });

  it('matches artists by id, and mainCreditsOnly ignores a guest credit', async () => {
    const uploader = await createUser('up');
    const anyCredit = await createUser('any');
    const mainOnly = await createUser('main');
    const community = await createCommunity();
    // The first upload creates the artist; the filters then name its id.
    await upload(uploader.id, community.id, {
      collaborators: [{ artist: 'Guest Star', importance: 'main' }]
    });
    const guest = await testPrisma.artist.findFirstOrThrow({
      where: { name: 'Guest Star' }
    });
    await watch(anyCredit.id, { tags: [], artistIds: [guest.id] });
    await watch(mainOnly.id, {
      tags: [],
      artistIds: [guest.id],
      mainCreditsOnly: true
    });

    await upload(uploader.id, community.id, {
      collaborators: [
        { artist: 'Slowdive', importance: 'main' },
        { artist: 'Guest Star', importance: 'guest' }
      ]
    });

    expect(await hitsOf(anyCredit.id)).toHaveLength(1);
    expect(await hitsOf(mainOnly.id)).toEqual([]);
  });

  it('gives no hit to a member who cannot see the release', async () => {
    const uploader = await createUser('up');
    const member = await createUser('member');
    const stranger = await createUser('stranger');
    const closed = await createCommunity(RegistrationStatus.closed);
    // An upload requires membership (#709), so the uploader is admitted too.
    for (const userId of [uploader.id, member.id]) {
      await testPrisma.contributor.create({
        data: { userId, communities: { connect: { id: closed.id } } }
      });
    }
    await watch(member.id);
    await watch(stranger.id);

    await upload(uploader.id, closed.id);

    expect(await hitsOf(member.id)).toHaveLength(1);
    expect(await hitsOf(stranger.id)).toEqual([]);
  });

  it('matches through the workbench path too', async () => {
    const uploader = await createUser('up');
    const watcher = await createUser('w');
    const community = await createCommunity();
    const first = await upload(uploader.id, community.id);
    await watch(watcher.id);

    const second = await addContributionToRelease({
      userId: uploader.id,
      communityId: community.id,
      releaseId: first.release.id,
      input: {
        fileType: FileType.mp3,
        downloadUrl: 'https://example.com/second.torrent',
        sizeInBytes: 1_000_000,
        releaseDescription: 'desc'
      } as never
    });
    await drainBackgroundTasks();

    expect(await hitsOf(watcher.id)).toEqual([
      expect.objectContaining({ contributionId: second!.id })
    ]);
  });
});

describe('newReleasesOnly', () => {
  it('fires on the first FLAC after MP3s, and not on the second FLAC', async () => {
    const uploader = await createUser('up');
    const watcher = await createUser('w');
    const community = await createCommunity();
    const mp3 = await upload(uploader.id, community.id, {
      fileType: FileType.mp3
    });
    await watch(watcher.id, {
      tags: [],
      newReleasesOnly: true,
      fileTypes: ['flac']
    });

    const add = async (fileType: FileType) => {
      const c = await addContributionToRelease({
        userId: uploader.id,
        communityId: community.id,
        releaseId: mp3.release.id,
        input: {
          fileType,
          downloadUrl: `https://example.com/${fileType}-${Math.random()}.torrent`,
          sizeInBytes: 1_000_000,
          releaseDescription: 'desc'
        } as never
      });
      await drainBackgroundTasks();
      return c!;
    };
    const firstFlac = await add(FileType.flac);
    await add(FileType.flac);

    expect(await hitsOf(watcher.id)).toEqual([
      expect.objectContaining({ contributionId: firstFlac.id })
    ]);
  });
});

describe('hits are counted and listed per contribution', () => {
  const setup = async () => {
    const uploader = await createUser('up');
    const watcher = await createUser('w');
    const community = await createCommunity();
    const byTag = await watch(watcher.id, { label: 'by tag' });
    const byYear = await watch(watcher.id, {
      label: 'by year',
      tags: [],
      fromYear: 1990,
      toYear: 1999
    });
    const c = await upload(uploader.id, community.id);
    return { watcher, community, byTag, byYear, c };
  };

  it('two filters catching one upload are one unread and one item', async () => {
    const { watcher, byTag, byYear, c } = await setup();

    expect(await hitsOf(watcher.id)).toHaveLength(2);
    expect(await countUnreadNotificationFilterHits(watcher.id)).toBe(1);
    const { items, total } = await listNotificationFilterHits(watcher.id, {
      skip: 0,
      take: 25
    });
    expect(total).toBe(1);
    expect(items).toEqual([
      expect.objectContaining({
        contributionId: c.id,
        read: false,
        filters: [
          { id: byTag.id, label: 'by tag' },
          { id: byYear.id, label: 'by year' }
        ]
      })
    ]);
  });

  it('reading it in the combined view reads every filter’s row', async () => {
    const { watcher, c } = await setup();

    await markNotificationFilterHitRead(watcher.id, c.id);

    expect((await hitsOf(watcher.id)).every((h) => h.readAt !== null)).toBe(
      true
    );
    expect(await countUnreadNotificationFilterHits(watcher.id)).toBe(0);
  });

  it('a per-filter catch-up leaves the other filter holding it unread', async () => {
    const { watcher, byTag, byYear } = await setup();

    await catchUpNotificationFilterHits(watcher.id, byTag.id);

    expect(await countUnreadNotificationFilterHits(watcher.id)).toBe(1);
    const perFilter = await listNotificationFilterHits(watcher.id, {
      filterId: byTag.id,
      skip: 0,
      take: 25
    });
    expect(perFilter.items[0].read).toBe(true);
    const other = await listNotificationFilterHits(watcher.id, {
      filterId: byYear.id,
      unread: true,
      skip: 0,
      take: 25
    });
    expect(other.total).toBe(1);
  });

  it('clearing removes read hits and spares unread ones', async () => {
    const { watcher, byTag, byYear } = await setup();
    await catchUpNotificationFilterHits(watcher.id, byTag.id);

    await clearReadNotificationFilterHits(watcher.id);

    expect(await hitsOf(watcher.id)).toEqual([
      expect.objectContaining({ filterId: byYear.id, readAt: null })
    ]);
  });

  it('hides hits on a release the member can no longer see', async () => {
    const { watcher, community } = await setup();

    await testPrisma.community.update({
      where: { id: community.id },
      data: { registrationStatus: RegistrationStatus.closed }
    });

    expect(await countUnreadNotificationFilterHits(watcher.id)).toBe(0);
    expect(
      (await listNotificationFilterHits(watcher.id, { skip: 0, take: 25 }))
        .total
    ).toBe(0);
    // The rows stay: regaining access brings them back.
    expect(await hitsOf(watcher.id)).toHaveLength(2);
  });

  it('deleting the contribution takes its hits with it', async () => {
    const { watcher, c } = await setup();

    await testPrisma.releaseFile.deleteMany({
      where: { contributionId: c.id }
    });
    await testPrisma.contribution.delete({ where: { id: c.id } });

    expect(await hitsOf(watcher.id)).toEqual([]);
  });
});
