/**
 * AST extraction (#564). The cases below are the ones a regex got wrong, and
 * each corresponds to a specific miscount in the issue's history.
 */
import { collectMutationSites, type ModelFacts } from './prismaMutationSites';

const models: ModelFacts = {
  // owns an FK → an unguarded create can dangle it (arm A)
  bookmarkArtist: { fk: true, unique: true },
  // no FK, no unique → a create is safe, but update/delete still throw P2025
  news: { fk: false, unique: false },
  auditLog: { fk: true, unique: false }
};

const scan = (sourceText: string, over = {}) =>
  collectMutationSites({
    fileName: 'src/routes/api/things.ts',
    sourceText,
    models,
    area: 'routes',
    ...over
  });

describe('collectMutationSites', () => {
  it('sees tx.* inside an interactive transaction', () => {
    // Every count published for #564 read prisma.* only, so 133 tx.* sites
    // across the tree appeared in none of them.
    const s = scan(`
      await prisma.$transaction(async (tx) => {
        await tx.bookmarkArtist.create({ data: {} });
      });
    `);
    expect(s).toHaveLength(1);
    expect(s[0].arm).toBe('A');
  });

  it('sees a client held under another name', () => {
    // lib/audit.ts writes through `(client as PrismaClient).auditLog.create`.
    // Keying on the receiver being `prisma`/`tx` made that site invisible.
    const s = scan(`(client as PrismaClient).auditLog.create({ data: {} });`);
    expect(s).toHaveLength(1);
    expect(s[0].model).toBe('auditLog');
  });

  it('does not collect reads', () => {
    expect(scan(`await prisma.news.findUnique({ where: { id } });`)).toEqual(
      []
    );
  });

  it('ignores a property that is not a known Prisma model', () => {
    expect(scan(`await cache.entries.delete({ where: { id } });`)).toEqual([]);
  });

  describe('arms', () => {
    it('A: a create is a candidate only when the model is constrained', () => {
      expect(scan(`prisma.bookmarkArtist.create({});`)[0].arm).toBe('A');
      expect(scan(`prisma.news.create({});`)[0].arm).toBeNull();
    });

    it('B: update/delete are candidates on ANY model, constrained or not', () => {
      // This is the arm every earlier tally missed. `News` has no FK and no
      // @unique, yet PUT /announcements/{id} 500s on a missing row.
      expect(scan(`prisma.news.update({ where: { id } });`)[0].arm).toBe('B');
      expect(scan(`prisma.news.delete({ where: { id } });`)[0].arm).toBe('B');
    });

    it('the *Many variants are never candidates', () => {
      // They no-op on zero rows rather than throwing P2025.
      expect(scan(`prisma.news.deleteMany({});`)[0].arm).toBeNull();
      expect(scan(`prisma.news.updateMany({});`)[0].arm).toBeNull();
      expect(scan(`prisma.bookmarkArtist.createMany({});`)[0].arm).toBeNull();
    });
  });

  describe('guard detection', () => {
    it('a catch translating a Prisma code guards the site', () => {
      const s = scan(`
        try {
          await prisma.bookmarkArtist.create({});
        } catch (err) {
          if (err.code === 'P2002') throw new AppError(409, 'x');
        }
      `);
      expect(s[0].guarded).toBe(true);
    });

    it('a catch that does NOT mention a Prisma code does not guard it', () => {
      const s = scan(`
        try {
          await prisma.bookmarkArtist.create({});
        } catch (err) {
          logger.warn(err);
        }
      `);
      expect(s[0].guarded).toBe(false);
    });

    it('a write inside the CATCH block is not guarded by that catch', () => {
      const s = scan(`
        try {
          doSomething();
        } catch (err) {
          if (err.code === 'P2002') await prisma.bookmarkArtist.create({});
        }
      `);
      expect(s[0].guarded).toBe(false);
    });

    it('an enclosing guarded try still counts through nested blocks', () => {
      const s = scan(`
        try {
          if (x) { for (const y of ys) { await prisma.bookmarkArtist.create({}); } }
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError) throw err;
        }
      `);
      expect(s[0].guarded).toBe(true);
    });
  });

  describe('keys', () => {
    it('keys a route on its operation, with the mount prefix applied', () => {
      const s = scan(
        `router.post('/artists/:artistId', asyncHandler(async (req, res) => {
           await prisma.bookmarkArtist.create({});
         }));`,
        { mountPrefix: '/bookmarks' }
      );
      expect(s[0].key).toBe(
        'POST /bookmarks/artists/{artistId}::bookmarkArtist.create'
      );
    });

    it('converts :params in the mount prefix too', () => {
      const s = scan(
        `router.delete('/x', h(async () => { await prisma.news.delete({}); }));`,
        {
          mountPrefix: '/communities/:communityId/dnc'
        }
      );
      expect(s[0].key).toBe(
        'DELETE /communities/{communityId}/dnc/x::news.delete'
      );
    });

    it('keys a module site on its exported function', () => {
      const s = scan(
        `export const updateTopic = async () => { await prisma.news.update({}); };`,
        {
          fileName: 'src/modules/forum.ts',
          area: 'modules',
          mountPrefix: ''
        }
      );
      expect(s[0].key).toBe('src/modules/forum.ts::updateTopic::news.update');
    });

    it('appends an ordinal when one owner repeats a model+op', () => {
      // 116 of 545 sites collide under a bare file::model.op key, so clearing
      // one entry would silently clear the others.
      const s = scan(`export const f = async () => {
        await prisma.news.update({ where: { a } });
        await prisma.news.update({ where: { b } });
      };`);
      expect(s.map((x) => x.key)).toEqual([
        'src/routes/api/things.ts::f::news.update',
        'src/routes/api/things.ts::f::news.update#2'
      ]);
    });
  });
});
