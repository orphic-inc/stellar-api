/**
 * The Member Feed's reads against a real database (ADR-0014 §3, #262).
 *
 * The claims here are about which rows reach a feed, and a mocked Prisma can
 * only echo back the where clause it was handed: that `releaseVisibleTo(owner)`
 * really hides a private-community contribution from a non-member and shows it
 * to a member, that the bookmark feed's two arms each match and never double a
 * row, and that the filters narrow what they name.
 */
import {
  ArtistRole,
  Bitrate,
  CommunityType,
  FileType,
  RegistrationStatus,
  ReleaseCategory,
  ReleaseType
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  renderBookmarksFeed,
  renderContributionsFeed,
  renderMineFeed
} from '../modules/feeds';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;
const tag = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;
// Dot-separated, so the name is already canonical (#689): the feed filter
// normalizes what it is given before matching.
const tagName = (prefix: string) => `${prefix}.${Date.now()}.${seq++}`;

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
      name: tag(`MF-${registrationStatus}`),
      image: '',
      registrationStatus,
      type: CommunityType.Music
    }
  });

const contribute = async (opts: {
  userId: number;
  communityId: number;
  title: string;
  type?: FileType;
  bitrate?: Bitrate;
}) => {
  const release = await testPrisma.release.create({
    data: {
      title: opts.title,
      description: 'desc',
      communityId: opts.communityId,
      type: ReleaseType.Music,
      releaseType: ReleaseCategory.Album,
      year: 2020
    }
  });
  const edition = await testPrisma.edition.create({
    data: { releaseId: release.id }
  });
  const contributor = await testPrisma.contributor.upsert({
    where: { userId: opts.userId },
    update: { communities: { connect: { id: opts.communityId } } },
    create: {
      userId: opts.userId,
      communities: { connect: { id: opts.communityId } }
    }
  });
  await testPrisma.contribution.create({
    data: {
      userId: opts.userId,
      releaseId: release.id,
      contributorId: contributor.id,
      editionId: edition.id,
      type: opts.type ?? FileType.flac,
      downloadUrl: 'https://example.com/secret-download.torrent',
      sizeInBytes: 1_000_000,
      approvedAccountingBytes: 1_000_000n,
      releaseDescription: 'test',
      ...(opts.bitrate && {
        releaseFile: { create: { bitrate: opts.bitrate } }
      })
    }
  });
  return release;
};

/** Item titles in feed order, stripped of the `[type]` suffix. */
const titles = (xml: string) =>
  [...xml.matchAll(/<item>\s*<title>([^<]*)<\/title>/g)].map((m) =>
    m[1].replace(/ \[\w+\]$/, '')
  );

describe('Member Feed reads against a real database', () => {
  it('hides a private-community contribution from a non-member, and shows it to a member', async () => {
    const uploader = await createUser('mf-up');
    const stranger = await createUser('mf-stranger');
    const member = await createUser('mf-member');
    const open = await createCommunity(RegistrationStatus.open);
    const closed = await createCommunity(RegistrationStatus.closed);
    await testPrisma.community.update({
      where: { id: closed.id },
      data: { curators: { connect: { id: member.id } } }
    });
    await contribute({
      userId: uploader.id,
      communityId: open.id,
      title: 'Public'
    });
    await contribute({
      userId: uploader.id,
      communityId: closed.id,
      title: 'Private'
    });

    expect(titles(await renderContributionsFeed(stranger.id, {}))).toEqual([
      'Public'
    ]);
    expect(titles(await renderContributionsFeed(member.id, {}))).toEqual([
      'Private',
      'Public'
    ]);
  });

  it('answers an empty feed, not an error, for a community the owner cannot see', async () => {
    const uploader = await createUser('mf-up');
    const stranger = await createUser('mf-stranger');
    const closed = await createCommunity(RegistrationStatus.closed);
    await contribute({
      userId: uploader.id,
      communityId: closed.id,
      title: 'Private'
    });

    const xml = await renderContributionsFeed(stranger.id, {
      community: closed.id
    });
    expect(titles(xml)).toEqual([]);
    expect(xml).toContain('<channel>');
  });

  it('narrows by community, format and bitrate', async () => {
    const uploader = await createUser('mf-up');
    const a = await createCommunity(RegistrationStatus.open);
    const b = await createCommunity(RegistrationStatus.open);
    await contribute({
      userId: uploader.id,
      communityId: a.id,
      title: 'A-flac',
      bitrate: Bitrate.Lossless
    });
    await contribute({
      userId: uploader.id,
      communityId: a.id,
      title: 'A-mp3',
      type: FileType.mp3,
      bitrate: Bitrate.Kbps320
    });
    await contribute({
      userId: uploader.id,
      communityId: b.id,
      title: 'B-flac',
      bitrate: Bitrate.Lossless24
    });

    expect(
      titles(await renderContributionsFeed(uploader.id, { community: a.id }))
    ).toEqual(['A-mp3', 'A-flac']);
    expect(
      titles(
        await renderContributionsFeed(uploader.id, { format: FileType.mp3 })
      )
    ).toEqual(['A-mp3']);
    expect(
      titles(
        await renderContributionsFeed(uploader.id, {
          bitrate: Bitrate.Lossless24
        })
      )
    ).toEqual(['B-flac']);
    expect(
      titles(
        await renderContributionsFeed(uploader.id, {
          community: a.id,
          bitrate: Bitrate.Lossless24
        })
      )
    ).toEqual([]);
  });

  it('narrows by tag, following a tag alias to its good tag', async () => {
    const uploader = await createUser('mf-up');
    const open = await createCommunity(RegistrationStatus.open);
    const tagged = await contribute({
      userId: uploader.id,
      communityId: open.id,
      title: 'Tagged'
    });
    await contribute({
      userId: uploader.id,
      communityId: open.id,
      title: 'Untagged'
    });
    const good = await testPrisma.tag.create({
      data: { name: tagName('electronic') }
    });
    await testPrisma.releaseTag.create({
      data: { releaseId: tagged.id, tagId: good.id }
    });
    const badName = tagName('electronica');
    await testPrisma.tagAlias.create({
      data: { badTag: badName, goodTagId: good.id, createdById: uploader.id }
    });

    expect(
      titles(await renderContributionsFeed(uploader.id, { tag: good.name }))
    ).toEqual(['Tagged']);
    expect(
      titles(await renderContributionsFeed(uploader.id, { tag: badName }))
    ).toEqual(['Tagged']);
  });

  it("reads only the owner's own contributions into mine.xml", async () => {
    const owner = await createUser('mf-owner');
    const other = await createUser('mf-other');
    const open = await createCommunity(RegistrationStatus.open);
    await contribute({ userId: owner.id, communityId: open.id, title: 'Mine' });
    await contribute({
      userId: other.id,
      communityId: open.id,
      title: 'Theirs'
    });

    expect(titles(await renderMineFeed(owner.id))).toEqual(['Mine']);
  });

  /**
   * Four releases: one bookmarked directly, one crediting a bookmarked artist
   * as a guest, one matching both ways, and one matching neither.
   */
  const seedBookmarks = async (ownerId: number) => {
    const uploader = await createUser('mf-up');
    const open = await createCommunity(RegistrationStatus.open);
    const release = (title: string) =>
      contribute({ userId: uploader.id, communityId: open.id, title });
    const bookmarked = await release('Bookmarked release');
    const guestSpot = await release('Guest spot');
    const both = await release('Both ways');
    await release('Unrelated');

    const artist = await testPrisma.artist.create({
      data: { name: tag('Artist') }
    });
    await testPrisma.bookmarkArtist.create({
      data: { userId: ownerId, artistId: artist.id }
    });
    await testPrisma.releaseArtist.createMany({
      data: [
        {
          releaseId: guestSpot.id,
          artistId: artist.id,
          role: ArtistRole.Guest
        },
        { releaseId: both.id, artistId: artist.id, role: ArtistRole.Main }
      ]
    });
    await testPrisma.bookmarkRelease.createMany({
      data: [
        { userId: ownerId, releaseId: bookmarked.id },
        { userId: ownerId, releaseId: both.id }
      ]
    });
  };

  it('matches a bookmarked release and a bookmarked artist in any role, each once', async () => {
    const owner = await createUser('mf-owner');
    await seedBookmarks(owner.id);

    expect(titles(await renderBookmarksFeed(owner.id))).toEqual([
      'Both ways',
      'Guest spot',
      'Bookmarked release'
    ]);
  });

  it('attributes the uploader and never carries the download URL', async () => {
    const uploader = await createUser('mf-up');
    const open = await createCommunity(RegistrationStatus.open);
    await contribute({
      userId: uploader.id,
      communityId: open.id,
      title: 'Linked'
    });

    const xml = await renderContributionsFeed(uploader.id, {});
    expect(xml).toContain(`<dc:creator>${uploader.username}</dc:creator>`);
    expect(xml).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
    expect(xml).not.toContain('secret-download');
  });
});
