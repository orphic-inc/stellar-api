/**
 * `artistsAdded` counts the artist credits a member attached (#722), and the
 * migration that attributes every credit written before #721.
 *
 * The backfill is exercised by running the migration's own SQL against rows
 * seeded with `addedById` null, so the test checks the file that ships rather
 * than a copy of its logic.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ArtistRole,
  CommunityType,
  FileType,
  RegistrationStatus,
  ReleaseCategory,
  ReleaseHistoryAction,
  ReleaseType
} from '@prisma/client';
import {
  truncateAll,
  seedDefaults,
  testPrisma,
  uniqueName
} from '../test/dbHelpers';
import { getProfileById } from '../modules/profile';
import { createCommunityRelease } from '../modules/releaseLifecycle';
import { addReleaseWorkbenchCredit } from '../modules/releaseWorkbench/credits';

const BACKFILL_SQL = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260928120000_backfill_release_credit_adders/migration.sql'
  ),
  'utf8'
);

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
  const username = uniqueName(`paa-${tag}`);
  return testPrisma.user.create({
    data: {
      username,
      email: `${username}@example.com`,
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
      name: uniqueName('PAA'),
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });

const createArtist = (name: string) =>
  testPrisma.artist.create({ data: { name: uniqueName(name) } });

/** A release with one credit whose adder is unknown, as every pre-#721 row was. */
const legacyRelease = async (communityId: number) => {
  const artist = await createArtist('Legacy');
  return testPrisma.release.create({
    data: {
      communityId,
      title: uniqueName('Legacy'),
      description: 'desc',
      type: ReleaseType.Music,
      releaseType: ReleaseCategory.Album,
      year: 2020,
      credits: { create: { artistId: artist.id, role: ArtistRole.Main } }
    }
  });
};

const contribute = async (
  userId: number,
  releaseId: number,
  communityId: number
) => {
  const edition = await testPrisma.edition.create({ data: { releaseId } });
  const contributor = await testPrisma.contributor.upsert({
    where: { userId },
    update: {},
    create: { userId, communities: { connect: { id: communityId } } }
  });
  await testPrisma.contribution.create({
    data: {
      userId,
      releaseId,
      contributorId: contributor.id,
      editionId: edition.id,
      type: FileType.flac,
      downloadUrl: 'https://example.com/file.torrent',
      sizeInBytes: 1_000_000,
      approvedAccountingBytes: 1_000_000n,
      releaseDescription: 'test'
    }
  });
};

const addersOf = async (releaseId: number) =>
  (
    await testPrisma.releaseArtist.findMany({
      where: { releaseId },
      select: { addedById: true }
    })
  ).map((row) => row.addedById);

const artistsAddedOf = async (userId: number) => {
  const view = (await getProfileById(userId, userId, {
    showMature: false
  })) as unknown as {
    percentiles: { artistsAdded: { raw: number; rank: number } };
  };
  return view.percentiles.artistsAdded;
};

describe('artistsAdded counts credits attached (#722)', () => {
  it("counts a member's credits, not credits others added to their release", async () => {
    const owner = await createUser('owner');
    const curator = await createUser('curator');
    const community = await createCommunity();
    const main = await createArtist('Main');
    const guest = await createArtist('Guest');
    const release = await createCommunityRelease({
      actorId: owner.id,
      communityId: community.id,
      data: {
        credits: [{ artistId: main.id, role: ArtistRole.Main }],
        title: 'Owned',
        description: 'desc',
        type: ReleaseType.Music,
        releaseType: 'Album',
        year: 2020
      }
    });
    await addReleaseWorkbenchCredit(
      {
        actorId: curator.id,
        communityId: community.id,
        releaseId: release.id
      },
      { artistId: guest.id, role: ArtistRole.Guest }
    );
    await addReleaseWorkbenchCredit(
      {
        actorId: curator.id,
        communityId: community.id,
        releaseId: release.id
      },
      { artistId: main.id, role: ArtistRole.Producer }
    );

    expect((await artistsAddedOf(owner.id)).raw).toBe(1);
    expect(await artistsAddedOf(curator.id)).toMatchObject({
      raw: 2,
      rank: 1
    });
  });
});

describe('backfill migration (#722)', () => {
  it("attributes a release's credits to its created-history actor", async () => {
    const creator = await createUser('creator');
    const uploader = await createUser('uploader');
    const community = await createCommunity();
    const release = await legacyRelease(community.id);
    await testPrisma.releaseHistory.create({
      data: {
        releaseId: release.id,
        actorId: creator.id,
        action: ReleaseHistoryAction.created,
        summary: 'Release created',
        changedFields: []
      }
    });
    // A contribution too: the history row wins over it.
    await contribute(uploader.id, release.id, community.id);

    await testPrisma.$executeRawUnsafe(BACKFILL_SQL);

    expect(await addersOf(release.id)).toEqual([creator.id]);
  });

  it('falls back to the uploader of the earliest contribution', async () => {
    const first = await createUser('first');
    const later = await createUser('later');
    const community = await createCommunity();
    const release = await legacyRelease(community.id);
    await contribute(first.id, release.id, community.id);
    await contribute(later.id, release.id, community.id);

    await testPrisma.$executeRawUnsafe(BACKFILL_SQL);

    expect(await addersOf(release.id)).toEqual([first.id]);
  });

  it('leaves credits null when nothing says who wrote them', async () => {
    const community = await createCommunity();
    const release = await legacyRelease(community.id);

    await testPrisma.$executeRawUnsafe(BACKFILL_SQL);

    expect(await addersOf(release.id)).toEqual([null]);
  });

  it('keeps an adder already recorded, and changes nothing on a second run', async () => {
    const uploader = await createUser('uploader');
    const curator = await createUser('curator');
    const community = await createCommunity();
    const release = await legacyRelease(community.id);
    await contribute(uploader.id, release.id, community.id);
    const extra = await createArtist('Extra');
    await testPrisma.releaseArtist.create({
      data: {
        releaseId: release.id,
        artistId: extra.id,
        role: ArtistRole.Guest,
        addedById: curator.id
      }
    });

    await testPrisma.$executeRawUnsafe(BACKFILL_SQL);
    const once = await addersOf(release.id);
    await testPrisma.$executeRawUnsafe(BACKFILL_SQL);

    expect(once.sort()).toEqual([uploader.id, curator.id].sort());
    expect((await addersOf(release.id)).sort()).toEqual(once.sort());
  });
});
