import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

// ─── #564 arm B, against a real database ─────────────────────────────────────
//
// The route tests mock P2025, so they prove the translation but not the
// trigger. The claim being pinned here is the one the issue's original rule got
// WRONG: that a missing row throws on a model carrying no foreign key and no
// unique constraint at all.
//
// `News` is exactly that model. Under the constraint-only reading of #564 these
// operations classified as safe, and four accepted findings were mis-filed on
// that basis.
describe('arm B fires on a model with no constraints (#564)', () => {
  it('news.delete raises P2025 for a row that is not there', async () => {
    await expect(
      testPrisma.news.delete({ where: { id: 2_000_000_000 } })
    ).rejects.toMatchObject({ code: 'P2025' });
  });

  it('news.update raises P2025 for a row that is not there', async () => {
    await expect(
      testPrisma.news.update({
        where: { id: 2_000_000_000 },
        data: { title: 'x' }
      })
    ).rejects.toMatchObject({ code: 'P2025' });
  });

  it('confirms News really does carry no FK and no unique constraint', async () => {
    // Guards the premise itself: if a constraint were ever added to News, the
    // two assertions above would still pass for the wrong reason, and the
    // comment explaining why this file exists would quietly become false.
    const { Prisma } = await import('@prisma/client');
    const news = Prisma.dmmf.datamodel.models.find((m) => m.name === 'News');

    expect(news).toBeDefined();
    expect(
      news!.fields.filter((f) => (f.relationFromFields ?? []).length > 0)
    ).toHaveLength(0);
    expect(news!.uniqueFields).toHaveLength(0);
    expect(news!.fields.filter((f) => f.isUnique)).toHaveLength(0);
  });
});
