/**
 * Artist credits on an existing release (#721): add, change role, remove.
 *
 * Against a real database for the parts a mock cannot hold: the
 * `@@unique([releaseId, artistId, role])` constraint behind the 409s, the
 * last-credit guard, and the history rows each operation writes.
 */

import {
  ArtistRole,
  CommunityType,
  RegistrationStatus,
  ReleaseHistoryAction,
  ReleaseType
} from '@prisma/client';
import {
  truncateAll,
  seedDefaults,
  testPrisma,
  uniqueName
} from '../test/dbHelpers';
import {
  addReleaseWorkbenchCredit,
  changeReleaseWorkbenchCreditRole,
  removeReleaseWorkbenchCredit
} from '../modules/releaseWorkbench/credits';
import { getReleaseWorkbenchView } from '../modules/releaseWorkbench/load';
import { createCommunityRelease } from '../modules/releaseLifecycle';

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
      username: uniqueName(`rc-${tag}`),
      email: `${uniqueName(`rc-${tag}`)}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const createArtist = (name: string) =>
  testPrisma.artist.create({ data: { name: uniqueName(name) } });

/** A release in an open community, created by `creatorId` crediting `artistId` as Main. */
const setup = async () => {
  const creator = await createUser('creator');
  const member = await createUser('member');
  const other = await createUser('other');
  const community = await testPrisma.community.create({
    data: {
      name: uniqueName('RC'),
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });
  const main = await createArtist('Main');
  const guest = await createArtist('Guest');
  const release = await createCommunityRelease({
    actorId: creator.id,
    communityId: community.id,
    data: {
      credits: [{ artistId: main.id, role: ArtistRole.Main }],
      title: 'Credited',
      description: 'desc',
      type: ReleaseType.Music,
      releaseType: 'Album',
      year: 2020
    }
  });
  const ref = (actorId: number, permissions: Record<string, boolean> = {}) => ({
    actorId,
    communityId: community.id,
    releaseId: release.id,
    permissions
  });
  return { creator, member, other, main, guest, release, ref };
};

const MODERATOR = { communities_manage: true };

const historyOf = (releaseId: number) =>
  testPrisma.releaseHistory.findMany({
    where: { releaseId },
    orderBy: { id: 'asc' }
  });

describe('release credits (#721)', () => {
  it('attributes credits written at creation to the release creator', async () => {
    const { creator, release } = await setup();

    const credits = await testPrisma.releaseArtist.findMany({
      where: { releaseId: release.id }
    });

    expect(credits.map((c) => c.addedById)).toEqual([creator.id]);
  });

  it('lets any member add a credit, recording them and a history row', async () => {
    const { member, guest, release, ref } = await setup();

    const credit = await addReleaseWorkbenchCredit(ref(member.id), {
      artistId: guest.id,
      role: ArtistRole.Guest
    });

    expect(credit).toMatchObject({
      role: ArtistRole.Guest,
      addedById: member.id,
      artist: { id: guest.id, name: guest.name }
    });
    const history = await historyOf(release.id);
    expect(history.at(-1)).toMatchObject({
      action: ReleaseHistoryAction.credit_added,
      actorId: member.id,
      changedFields: ['credits'],
      summary: `Added ${guest.name} as Guest`,
      after: { artistId: guest.id, name: guest.name, role: 'Guest' },
      before: null
    });
  });

  it('shows each credit with its id and adder on the workbench view', async () => {
    const { member, creator, guest, ref } = await setup();
    const added = await addReleaseWorkbenchCredit(ref(member.id), {
      artistId: guest.id,
      role: ArtistRole.Guest
    });

    const view = await getReleaseWorkbenchView(ref(member.id));

    expect(view.release.credits.map((c) => c.addedById)).toEqual([
      creator.id,
      member.id
    ]);
    expect(view.release.credits[1].id).toBe(added.id);
  });

  it('answers 409 when the artist already holds that role', async () => {
    const { member, main, ref } = await setup();

    await expect(
      addReleaseWorkbenchCredit(ref(member.id), {
        artistId: main.id,
        role: ArtistRole.Main
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('answers 404 for a withdrawn artist', async () => {
    const { member, guest, ref } = await setup();
    await testPrisma.artist.update({
      where: { id: guest.id },
      data: { deletedAt: new Date() }
    });

    await expect(
      addReleaseWorkbenchCredit(ref(member.id), {
        artistId: guest.id,
        role: ArtistRole.Guest
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('keeps the adder when a moderator changes the role', async () => {
    const { member, other, guest, release, ref } = await setup();
    const credit = await addReleaseWorkbenchCredit(ref(member.id), {
      artistId: guest.id,
      role: ArtistRole.Guest
    });

    const changed = await changeReleaseWorkbenchCreditRole(
      ref(other.id, MODERATOR),
      { creditId: credit.id, role: ArtistRole.Producer }
    );

    expect(changed).toMatchObject({
      id: credit.id,
      role: ArtistRole.Producer,
      addedById: member.id
    });
    expect((await historyOf(release.id)).at(-1)).toMatchObject({
      action: ReleaseHistoryAction.credit_role_changed,
      actorId: other.id,
      before: { role: 'Guest' },
      after: { role: 'Producer' }
    });
  });

  it("lets the adder change their own credit's role, and no one else", async () => {
    const { member, other, guest, ref } = await setup();
    const credit = await addReleaseWorkbenchCredit(ref(member.id), {
      artistId: guest.id,
      role: ArtistRole.Guest
    });

    await expect(
      changeReleaseWorkbenchCreditRole(ref(other.id), {
        creditId: credit.id,
        role: ArtistRole.Remixer
      })
    ).rejects.toMatchObject({ statusCode: 403 });

    const changed = await changeReleaseWorkbenchCreditRole(ref(member.id), {
      creditId: credit.id,
      role: ArtistRole.Remixer
    });
    expect(changed.role).toBe(ArtistRole.Remixer);
  });

  it('writes no history for a role change to the same role', async () => {
    const { creator, release, ref } = await setup();
    const [credit] = await testPrisma.releaseArtist.findMany({
      where: { releaseId: release.id }
    });
    const before = (await historyOf(release.id)).length;

    await changeReleaseWorkbenchCreditRole(ref(creator.id), {
      creditId: credit.id,
      role: ArtistRole.Main
    });

    expect(await historyOf(release.id)).toHaveLength(before);
  });

  it('answers 409 when the new role is already held by that artist', async () => {
    const { member, main, ref } = await setup();
    const credit = await addReleaseWorkbenchCredit(ref(member.id), {
      artistId: main.id,
      role: ArtistRole.Producer
    });

    await expect(
      changeReleaseWorkbenchCreditRole(ref(member.id), {
        creditId: credit.id,
        role: ArtistRole.Main
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('removes a credit for its adder and records it', async () => {
    const { member, guest, release, ref } = await setup();
    const credit = await addReleaseWorkbenchCredit(ref(member.id), {
      artistId: guest.id,
      role: ArtistRole.Guest
    });

    await removeReleaseWorkbenchCredit(ref(member.id), { creditId: credit.id });

    expect(
      await testPrisma.releaseArtist.findUnique({ where: { id: credit.id } })
    ).toBeNull();
    expect((await historyOf(release.id)).at(-1)).toMatchObject({
      action: ReleaseHistoryAction.credit_removed,
      summary: `Removed ${guest.name} (Guest)`,
      before: { artistId: guest.id, role: 'Guest' },
      after: null
    });
    // The artist itself is untouched.
    expect(
      await testPrisma.artist.findUnique({ where: { id: guest.id } })
    ).toMatchObject({ deletedAt: null });
  });

  it("refuses to remove someone else's credit without moderation", async () => {
    const { other, release, ref } = await setup();
    const [credit] = await testPrisma.releaseArtist.findMany({
      where: { releaseId: release.id }
    });

    await expect(
      removeReleaseWorkbenchCredit(ref(other.id), { creditId: credit.id })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('keeps the last credit, even for a moderator', async () => {
    const { other, release, ref } = await setup();
    const [credit] = await testPrisma.releaseArtist.findMany({
      where: { releaseId: release.id }
    });

    await expect(
      removeReleaseWorkbenchCredit(ref(other.id, MODERATOR), {
        creditId: credit.id
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('leaves exactly one credit when every credit is removed at once', async () => {
    const { member, release, ref } = await setup();
    // Six credits, all removed concurrently, so the removals contend: without
    // the release row lock each sees the others' credits as survivors.
    for (const role of [
      ArtistRole.Guest,
      ArtistRole.Composer,
      ArtistRole.Producer,
      ArtistRole.Remixer,
      ArtistRole.Arranger
    ]) {
      const artist = await createArtist(role);
      await addReleaseWorkbenchCredit(ref(member.id), {
        artistId: artist.id,
        role
      });
    }
    const credits = await testPrisma.releaseArtist.findMany({
      where: { releaseId: release.id }
    });
    expect(credits).toHaveLength(6);

    const results = await Promise.allSettled(
      credits.map((credit) =>
        removeReleaseWorkbenchCredit(ref(member.id, MODERATOR), {
          creditId: credit.id
        })
      )
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(
      await testPrisma.releaseArtist.count({ where: { releaseId: release.id } })
    ).toBe(1);
  });

  it('answers 404 for a credit on another release', async () => {
    const first = await setup();
    const second = await setup();
    const [foreign] = await testPrisma.releaseArtist.findMany({
      where: { releaseId: second.release.id }
    });

    await expect(
      removeReleaseWorkbenchCredit(first.ref(first.member.id, MODERATOR), {
        creditId: foreign.id
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
