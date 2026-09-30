import { randomUUID } from 'node:crypto';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { revertArtistFromHistory, updateArtist } from '../modules/artist';

/**
 * Edit and revert write only a live artist (#804), against real rows. A
 * withdrawn artist keeps its row, and release credits still show its name, so
 * a write that reached one would rename it wherever it is credited.
 */
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async () => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const tag = randomUUID().slice(0, 8);
  return testPrisma.user.create({
    data: {
      username: `ae-${tag}`,
      email: `ae-${tag}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

/** An artist with one history entry naming it 'Original'. */
const artistWithHistory = async (editorId: number) => {
  const artist = await testPrisma.artist.create({
    data: { name: 'Renamed' }
  });
  const entry = await testPrisma.artistHistory.create({
    data: {
      artistId: artist.id,
      editedBy: editorId,
      data: { name: 'Original' }
    }
  });
  return { artist, entry };
};

const withdraw = (id: number) =>
  testPrisma.artist.update({ where: { id }, data: { deletedAt: new Date() } });

const historyCount = (artistId: number) =>
  testPrisma.artistHistory.count({ where: { artistId } });

const nameOf = async (id: number) =>
  (await testPrisma.artist.findUniqueOrThrow({ where: { id } })).name;

describe('editing an artist', () => {
  it('edits a live artist and records the edit', async () => {
    const editor = await createUser();
    const { artist } = await artistWithHistory(editor.id);

    const edited = await updateArtist(artist.id, editor.id, { name: 'New' });

    expect(edited.name).toBe('New');
    expect(await historyCount(artist.id)).toBe(2);
  });

  it('refuses a withdrawn artist, writing nothing (#804)', async () => {
    const editor = await createUser();
    const { artist } = await artistWithHistory(editor.id);
    await withdraw(artist.id);

    await expect(
      updateArtist(artist.id, editor.id, { name: 'Late' })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(await nameOf(artist.id)).toBe('Renamed');
    expect(await historyCount(artist.id)).toBe(1);
  });
});

describe('reverting an artist', () => {
  it('restores a live artist from a history entry', async () => {
    const editor = await createUser();
    const { artist, entry } = await artistWithHistory(editor.id);

    const reverted = await revertArtistFromHistory({
      historyId: entry.id,
      editedBy: editor.id
    });

    expect(reverted?.name).toBe('Original');
    expect(await historyCount(artist.id)).toBe(2);
  });

  it('refuses a withdrawn artist, writing nothing (#804)', async () => {
    const editor = await createUser();
    const { artist, entry } = await artistWithHistory(editor.id);
    await withdraw(artist.id);

    expect(
      await revertArtistFromHistory({
        historyId: entry.id,
        editedBy: editor.id
      })
    ).toBeNull();

    expect(await nameOf(artist.id)).toBe('Renamed');
    expect(await historyCount(artist.id)).toBe(1);
  });
});
