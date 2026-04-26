import { ReleaseType, ReleaseCategory } from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';

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
      username: `collageu-${tag}-${Date.now()}`,
      email: `collageu-${tag}-${Date.now()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const createRelease = async (artistId: number) =>
  testPrisma.release.create({
    data: {
      artistId,
      title: `Release-${Date.now()}-${Math.random()}`,
      description: 'desc',
      type: ReleaseType.Music,
      releaseType: ReleaseCategory.Album,
      year: 2020
    }
  });

const createArtist = () =>
  testPrisma.artist.create({ data: { name: `Artist-${Date.now()}` } });

const createCollage = async (userId: number, categoryId = 1) =>
  testPrisma.collage.create({
    data: {
      name: `Collage-${Date.now()}-${Math.random()}`,
      description: 'A test collage',
      userId,
      categoryId,
      tags: []
    }
  });

// Mirrors the $transaction used in POST /:id/entries
const addEntry = async (
  collageId: number,
  releaseId: number,
  userId: number,
  sort: number
) => {
  return testPrisma.$transaction([
    testPrisma.collageEntry.create({
      data: { collageId, releaseId, userId, sort }
    }),
    testPrisma.collage.update({
      where: { id: collageId },
      data: { numEntries: { increment: 1 } }
    })
  ]);
};

// Mirrors the $transaction used in DELETE /:id/entries/:releaseId
const removeEntry = async (collageId: number, releaseId: number) => {
  const entry = await testPrisma.collageEntry.findUniqueOrThrow({
    where: { collageId_releaseId: { collageId, releaseId } }
  });
  return testPrisma.$transaction([
    testPrisma.collageEntry.delete({ where: { id: entry.id } }),
    testPrisma.collage.update({
      where: { id: collageId },
      data: { numEntries: { decrement: 1 } }
    })
  ]);
};

// Mirrors subscribe toggle logic in POST /:id/subscribe
const toggleSubscribe = async (collageId: number, userId: number) => {
  const existing = await testPrisma.collageSubscription.findUnique({
    where: { userId_collageId: { userId, collageId } }
  });
  if (existing) {
    await testPrisma.$transaction([
      testPrisma.collageSubscription.delete({ where: { id: existing.id } }),
      testPrisma.collage.update({
        where: { id: collageId },
        data: { numSubscribers: { decrement: 1 } }
      })
    ]);
    return 'unsubscribed';
  }
  await testPrisma.$transaction([
    testPrisma.collageSubscription.create({ data: { userId, collageId } }),
    testPrisma.collage.update({
      where: { id: collageId },
      data: { numSubscribers: { increment: 1 } }
    })
  ]);
  return 'subscribed';
};

describe('collage entry counter', () => {
  it('increments numEntries atomically when an entry is added', async () => {
    const user = await createUser('a');
    const artist = await createArtist();
    const release = await createRelease(artist.id);
    const collage = await createCollage(user.id);

    expect(collage.numEntries).toBe(0);

    await addEntry(collage.id, release.id, user.id, 10);

    const updated = await testPrisma.collage.findUniqueOrThrow({
      where: { id: collage.id }
    });
    expect(updated.numEntries).toBe(1);
  });

  it('decrements numEntries atomically when an entry is removed', async () => {
    const user = await createUser('b');
    const artist = await createArtist();
    const release = await createRelease(artist.id);
    const collage = await createCollage(user.id);
    await addEntry(collage.id, release.id, user.id, 10);

    await removeEntry(collage.id, release.id);

    const updated = await testPrisma.collage.findUniqueOrThrow({
      where: { id: collage.id }
    });
    expect(updated.numEntries).toBe(0);
  });

  it('keeps numEntries correct across multiple add/remove cycles', async () => {
    const user = await createUser('c');
    const artist = await createArtist();
    const r1 = await createRelease(artist.id);
    const r2 = await createRelease(artist.id);
    const collage = await createCollage(user.id);

    await addEntry(collage.id, r1.id, user.id, 10);
    await addEntry(collage.id, r2.id, user.id, 20);

    let snap = await testPrisma.collage.findUniqueOrThrow({
      where: { id: collage.id }
    });
    expect(snap.numEntries).toBe(2);

    await removeEntry(collage.id, r1.id);
    snap = await testPrisma.collage.findUniqueOrThrow({
      where: { id: collage.id }
    });
    expect(snap.numEntries).toBe(1);
  });
});

describe('collage subscription counter', () => {
  it('increments numSubscribers on first subscribe', async () => {
    const owner = await createUser('d');
    const subscriber = await createUser('e');
    const collage = await createCollage(owner.id);

    await toggleSubscribe(collage.id, subscriber.id);

    const updated = await testPrisma.collage.findUniqueOrThrow({
      where: { id: collage.id }
    });
    expect(updated.numSubscribers).toBe(1);
  });

  it('decrements numSubscribers on unsubscribe', async () => {
    const owner = await createUser('f');
    const subscriber = await createUser('g');
    const collage = await createCollage(owner.id);

    await toggleSubscribe(collage.id, subscriber.id);
    await toggleSubscribe(collage.id, subscriber.id);

    const updated = await testPrisma.collage.findUniqueOrThrow({
      where: { id: collage.id }
    });
    expect(updated.numSubscribers).toBe(0);
  });

  it('tracks multiple subscribers independently', async () => {
    const owner = await createUser('h');
    const s1 = await createUser('i');
    const s2 = await createUser('j');
    const collage = await createCollage(owner.id);

    await toggleSubscribe(collage.id, s1.id);
    await toggleSubscribe(collage.id, s2.id);

    const updated = await testPrisma.collage.findUniqueOrThrow({
      where: { id: collage.id }
    });
    expect(updated.numSubscribers).toBe(2);
  });
});

describe('duplicate entry prevention', () => {
  it('rejects inserting the same release twice (DB unique constraint)', async () => {
    const user = await createUser('k');
    const artist = await createArtist();
    const release = await createRelease(artist.id);
    const collage = await createCollage(user.id);

    await testPrisma.collageEntry.create({
      data: {
        collageId: collage.id,
        releaseId: release.id,
        userId: user.id,
        sort: 10
      }
    });

    await expect(
      testPrisma.collageEntry.create({
        data: {
          collageId: collage.id,
          releaseId: release.id,
          userId: user.id,
          sort: 20
        }
      })
    ).rejects.toThrow();
  });

  it('allows the same release in two different collages', async () => {
    const user = await createUser('l');
    const artist = await createArtist();
    const release = await createRelease(artist.id);
    const c1 = await createCollage(user.id);
    const c2 = await createCollage(user.id);

    await testPrisma.collageEntry.create({
      data: {
        collageId: c1.id,
        releaseId: release.id,
        userId: user.id,
        sort: 10
      }
    });

    await expect(
      testPrisma.collageEntry.create({
        data: {
          collageId: c2.id,
          releaseId: release.id,
          userId: user.id,
          sort: 10
        }
      })
    ).resolves.not.toThrow();
  });
});

describe('featured collage mutual exclusivity', () => {
  it('updateMany clears other featured collages when one is set featured', async () => {
    const user = await createUser('m');
    const c1 = await testPrisma.collage.create({
      data: {
        name: `Featured-A-${Date.now()}`,
        description: 'desc',
        userId: user.id,
        categoryId: 0,
        tags: [],
        isFeatured: true
      }
    });
    const c2 = await testPrisma.collage.create({
      data: {
        name: `Featured-B-${Date.now()}`,
        description: 'desc',
        userId: user.id,
        categoryId: 0,
        tags: []
      }
    });

    // Simulate route: clear all featured for this user, then set the new one
    await testPrisma.$transaction([
      testPrisma.collage.updateMany({
        where: { userId: user.id, isFeatured: true },
        data: { isFeatured: false }
      }),
      testPrisma.collage.update({
        where: { id: c2.id },
        data: { isFeatured: true }
      })
    ]);

    const [dbC1, dbC2] = await Promise.all([
      testPrisma.collage.findUniqueOrThrow({ where: { id: c1.id } }),
      testPrisma.collage.findUniqueOrThrow({ where: { id: c2.id } })
    ]);

    expect(dbC1.isFeatured).toBe(false);
    expect(dbC2.isFeatured).toBe(true);
  });
});

describe('soft vs hard delete', () => {
  it('soft delete sets isDeleted and deletedAt, row is preserved', async () => {
    const user = await createUser('n');
    const collage = await createCollage(user.id);

    await testPrisma.collage.update({
      where: { id: collage.id },
      data: { isDeleted: true, deletedAt: new Date() }
    });

    const row = await testPrisma.collage.findUnique({
      where: { id: collage.id }
    });
    expect(row).not.toBeNull();
    expect(row!.isDeleted).toBe(true);
    expect(row!.deletedAt).not.toBeNull();
  });

  it('hard delete removes the row entirely', async () => {
    const user = await createUser('o');
    const collage = await createCollage(user.id, 0);

    await testPrisma.collage.delete({ where: { id: collage.id } });

    const row = await testPrisma.collage.findUnique({
      where: { id: collage.id }
    });
    expect(row).toBeNull();
  });

  it('hard delete cascades to entries', async () => {
    const user = await createUser('p');
    const artist = await createArtist();
    const release = await createRelease(artist.id);
    const collage = await createCollage(user.id, 0);

    await testPrisma.collageEntry.create({
      data: {
        collageId: collage.id,
        releaseId: release.id,
        userId: user.id,
        sort: 10
      }
    });

    await testPrisma.collage.delete({ where: { id: collage.id } });

    const entry = await testPrisma.collageEntry.findFirst({
      where: { collageId: collage.id }
    });
    expect(entry).toBeNull();
  });

  it('soft deleted collage can be recovered (isDeleted cleared)', async () => {
    const user = await createUser('q');
    const collage = await createCollage(user.id);

    await testPrisma.collage.update({
      where: { id: collage.id },
      data: { isDeleted: true, deletedAt: new Date() }
    });

    await testPrisma.collage.update({
      where: { id: collage.id },
      data: { isDeleted: false, deletedAt: null }
    });

    const row = await testPrisma.collage.findUniqueOrThrow({
      where: { id: collage.id }
    });
    expect(row.isDeleted).toBe(false);
    expect(row.deletedAt).toBeNull();
  });
});
