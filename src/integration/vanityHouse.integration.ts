import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createArtist = (name: string) =>
  testPrisma.artist.create({ data: { name, vanityHouse: false } });

describe('vanity house toggle', () => {
  it('sets vanityHouse to true on an artist', async () => {
    const artist = await createArtist('Test Artist A');
    expect(artist.vanityHouse).toBe(false);

    const updated = await testPrisma.artist.update({
      where: { id: artist.id },
      data: { vanityHouse: true }
    });
    expect(updated.vanityHouse).toBe(true);
  });

  it('clears vanityHouse back to false', async () => {
    const artist = await createArtist('Test Artist B');
    await testPrisma.artist.update({
      where: { id: artist.id },
      data: { vanityHouse: true }
    });

    const cleared = await testPrisma.artist.update({
      where: { id: artist.id },
      data: { vanityHouse: false }
    });
    expect(cleared.vanityHouse).toBe(false);
  });

  it('querying vanity house artists returns only flagged artists', async () => {
    const a1 = await createArtist('VH Artist');
    const a2 = await createArtist('Normal Artist');
    await testPrisma.artist.update({
      where: { id: a1.id },
      data: { vanityHouse: true }
    });

    const vh = await testPrisma.artist.findMany({
      where: { vanityHouse: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { credits: true } } }
    });

    const ids = vh.map((a) => a.id);
    expect(ids).toContain(a1.id);
    expect(ids).not.toContain(a2.id);
    expect(vh[0]._count).toHaveProperty('credits');
  });

  it('throws when updating a non-existent artist', async () => {
    await expect(
      testPrisma.artist.update({
        where: { id: 999999 },
        data: { vanityHouse: true }
      })
    ).rejects.toThrow();
  });
});
