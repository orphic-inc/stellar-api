import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  createAuthorStylesheet,
  updateAuthorStylesheet,
  deleteAuthorStylesheet,
  getAuthorStylesheetById,
  listAuthorStylesheets,
  getAuthorStylesheetCss,
  adoptAuthorStylesheet
} from '../modules/authorStylesheet';
import { getReputation } from '../modules/reputation';
import { updateProfile } from '../modules/profile';
import { AppError } from '../lib/errors';

// Route-level pagination defaults (lib/pagination.ts); the module takes the
// already-derived PageParams, so integration calls build them directly.
const page = (p = 1, limit = 25) => ({
  page: p,
  limit,
  skip: (p - 1) * limit
});

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;
const createUser = async () => {
  seq += 1;
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `user-${seq}-${Date.now()}`,
      email: `user-${seq}-${Date.now()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const activeSlotOf = async (userId: number): Promise<number | null> => {
  const user = await testPrisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { userSettings: { select: { activeAuthorStylesheetId: true } } }
  });
  return user.userSettings.activeAuthorStylesheetId;
};

describe('AuthorStylesheet save → list (PRD-03 #118/#146, many per author)', () => {
  it('an author can save several stylesheets and list them all', async () => {
    const author = await createUser();
    await createAuthorStylesheet(author.id, {
      name: 'First',
      source: 'a {}'
    });
    await createAuthorStylesheet(author.id, {
      name: 'Second',
      source: 'b {}'
    });

    const [all, total] = await listAuthorStylesheets(author.id, page());
    expect(all).toHaveLength(2);
    expect(total).toBe(2);
    expect(all.map((s) => s.name)).toEqual(['First', 'Second']);
    // ADR-0024 §1 — a list payload carries metadata only; source stays behind
    // the per-id /css delivery route, never a JSON list.
    expect(all[0]).not.toHaveProperty('source');
  });

  it('pages through the list with a stable total (#146)', async () => {
    const author = await createUser();
    for (const name of ['One', 'Two', 'Three']) {
      await createAuthorStylesheet(author.id, {
        name,
        source: 'a {}'
      });
    }

    const [firstPage, total1] = await listAuthorStylesheets(
      author.id,
      page(1, 2)
    );
    const [secondPage, total2] = await listAuthorStylesheets(
      author.id,
      page(2, 2)
    );
    expect(firstPage.map((s) => s.name)).toEqual(['One', 'Two']);
    expect(secondPage.map((s) => s.name)).toEqual(['Three']);
    expect(total1).toBe(3);
    expect(total2).toBe(3);
  });

  it('honours a donor secondary rank above the primary limit (#369)', async () => {
    // PRD-03's "$tylesheets — donor-added slots" against a real rank set: the
    // perk is a secondary rank, and enforcement used to read the primary alone.
    const author = await createUser();
    await testPrisma.userRank.update({
      where: { id: author.userRankId },
      data: { authorStylesheetLimit: 1 }
    });
    const donorRank = await testPrisma.userRank.create({
      data: {
        level: 150,
        name: `Donor-${Date.now()}`,
        permissions: {},
        secondary: true,
        authorStylesheetLimit: 3
      }
    });
    await testPrisma.userSecondaryRank.create({
      data: { userId: author.id, userRankId: donorRank.id }
    });

    for (const name of ['One', 'Two', 'Three']) {
      await createAuthorStylesheet(author.id, { name, source: 'a {}' });
    }
    // The ceiling is the donor's 3, and the message quotes the number the
    // member was actually advertised.
    await expect(
      createAuthorStylesheet(author.id, {
        name: 'One too many',
        source: 'b {}'
      })
    ).rejects.toThrow('Author stylesheet limit reached (3)');
  });

  it('an unlimited primary rank is not capped by a donor secondary (#369)', async () => {
    // The Math.max inversion: a perk must never lower a ceiling. The seeded
    // primary rank leaves authorStylesheetLimit at its 0 default = unlimited.
    const author = await createUser();
    const donorRank = await testPrisma.userRank.create({
      data: {
        level: 150,
        name: `Donor-${Date.now()}`,
        permissions: {},
        secondary: true,
        authorStylesheetLimit: 2
      }
    });
    await testPrisma.userSecondaryRank.create({
      data: { userId: author.id, userRankId: donorRank.id }
    });

    for (const name of ['One', 'Two', 'Three']) {
      await createAuthorStylesheet(author.id, { name, source: 'a {}' });
    }
    expect(
      await testPrisma.authorStylesheet.count({
        where: { authorId: author.id }
      })
    ).toBe(3);
  });

  it('rejects creation past the rank-configured registry-space limit (#146)', async () => {
    const author = await createUser();
    await testPrisma.userRank.update({
      where: { id: author.userRankId },
      data: { authorStylesheetLimit: 1 }
    });

    await createAuthorStylesheet(author.id, {
      name: 'Allowed',
      source: 'a {}'
    });
    await expect(
      createAuthorStylesheet(author.id, {
        name: 'One too many',
        source: 'b {}'
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    const [, total] = await listAuthorStylesheets(author.id, page());
    expect(total).toBe(1);
  });
});

describe('AuthorStylesheet CSS delivery (ADR-0024 §1)', () => {
  it('refuses a sheet carrying an exfiltration vector — nothing is stored', async () => {
    const author = await createUser();
    // ADR-0031 §5: the boundary rejects rather than cleaning. This used to
    // assert the @import was stripped and the sheet saved anyway; a save that
    // silently mutates the author's bytes is the posture that was retired.
    await expect(
      createAuthorStylesheet(author.id, {
        name: 'Anorex',
        source:
          "@import url('http://evil.example/x.css'); body { color: #0f0; }"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      fieldErrors: {
        // Both violations, in source order — the `@import` and the external
        // `url()` it carries. Reporting every one is deliberate (ADR-0032 §6):
        // under a rejecting validator, first-fail turns a sheet with several
        // bad constructs into several save attempts. Asserting the exact list
        // is what makes that property fail loudly if it regresses to first-fail.
        source: [
          expect.stringContaining('another sheet'),
          expect.stringContaining('external address')
        ]
      }
    });

    expect(
      await testPrisma.authorStylesheet.count({
        where: { authorId: author.id }
      })
    ).toBe(0);
  });

  it('stores a clean sheet verbatim — /css returns the exact submitted bytes', async () => {
    const author = await createUser();
    // The other half of verbatim storage: escaped Tailwind identifiers survive.
    // The cleaning sanitizer rewrote `.hover\:text-white` here and broke the
    // selector for every adopter (#340).
    const source =
      'header .hover\\:text-white:hover { color: #111; }\nbody { color: #0f0; }';
    const sheet = await createAuthorStylesheet(author.id, {
      name: 'Verbatim',
      source
    });

    const delivered = await getAuthorStylesheetCss(sheet.id);
    expect(delivered).not.toBeNull();
    expect(delivered!.source).toBe(source);
  });

  it('returns null for a non-existent sheet (the route maps this to 404)', async () => {
    expect(await getAuthorStylesheetCss(999999)).toBeNull();
  });
});

describe('Site Stylesheet radio — Personal ⟷ Registry mutual exclusion (ADR-0024 §4)', () => {
  it('selecting Registry (pointer) clears a previously-set Personal URL', async () => {
    const author = await createUser();
    const member = await createUser();
    const sheet = await createAuthorStylesheet(author.id, {
      name: 'Reg',
      source: 'a {}'
    });

    await updateProfile(member.id, {
      externalStylesheet: 'https://cdn.example.com/mine.css'
    });
    await updateProfile(member.id, { activeAuthorStylesheetId: sheet.id });

    const settings = await testPrisma.user
      .findUniqueOrThrow({
        where: { id: member.id },
        select: { userSettings: true }
      })
      .then((u) => u.userSettings);
    expect(settings.activeAuthorStylesheetId).toBe(sheet.id);
    expect(settings.externalStylesheet).toBeNull();
  });

  it('selecting Personal (URL) clears a previously-set Registry pointer', async () => {
    const author = await createUser();
    const member = await createUser();
    const sheet = await createAuthorStylesheet(author.id, {
      name: 'Reg',
      source: 'a {}'
    });

    await updateProfile(member.id, { activeAuthorStylesheetId: sheet.id });
    await updateProfile(member.id, {
      externalStylesheet: 'https://cdn.example.com/mine.css'
    });

    const settings = await testPrisma.user
      .findUniqueOrThrow({
        where: { id: member.id },
        select: { userSettings: true }
      })
      .then((u) => u.userSettings);
    expect(settings.externalStylesheet).toBe(
      'https://cdn.example.com/mine.css'
    );
    expect(settings.activeAuthorStylesheetId).toBeNull();
  });

  it('rejects setting both sources in one write (400)', async () => {
    const author = await createUser();
    const member = await createUser();
    const sheet = await createAuthorStylesheet(author.id, {
      name: 'Reg',
      source: 'a {}'
    });

    await expect(
      updateProfile(member.id, {
        externalStylesheet: 'https://cdn.example.com/mine.css',
        activeAuthorStylesheetId: sheet.id
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a pointer at a non-existent sheet (400) — clean, not a raw FK 500', async () => {
    const member = await createUser();
    await expect(
      updateProfile(member.id, { activeAuthorStylesheetId: 999999 })
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('AuthorStylesheet lifecycle — edit + withdraw (ADR-0032 §2/§3, #368)', () => {
  it('edits in place, and the change reaches an existing adopter', () => {
    // #350: adoption tracks the author's edits. Sheet identity is a stable id
    // while content varies, which is why the /css route sets no-cache.
    return (async () => {
      const author = await createUser();
      const adopter = await createUser();
      const sheet = await createAuthorStylesheet(author.id, {
        name: 'Before',
        source: 'a { color: red; }'
      });
      await adoptAuthorStylesheet(adopter.id, sheet.id);

      await updateAuthorStylesheet(sheet.id, author.id, {
        name: 'After',
        source: 'a { color: blue; }'
      });

      const served = await getAuthorStylesheetCss(sheet.id);
      expect(served?.source).toBe('a { color: blue; }');
      expect(await activeSlotOf(adopter.id)).toBe(sheet.id);
    })();
  });

  it('refuses an edit from someone who is not the author', async () => {
    const author = await createUser();
    const stranger = await createUser();
    const sheet = await createAuthorStylesheet(author.id, {
      name: 'Mine',
      source: 'a {}'
    });

    await expect(
      updateAuthorStylesheet(sheet.id, stranger.id, {
        name: 'Yours now',
        source: 'b {}'
      })
    ).rejects.toThrow('Not your stylesheet');
  });

  it('holds an edit to the same ADR-0031 boundary as a create', async () => {
    const author = await createUser();
    const sheet = await createAuthorStylesheet(author.id, {
      name: 'Clean',
      source: 'a {}'
    });

    // The edit path must not be a way around the store-time validator.
    await expect(
      updateAuthorStylesheet(sheet.id, author.id, {
        name: 'Sneaky',
        source: 'a { background: url("javascript:alert(1)"); }'
      })
    ).rejects.toThrow();
  });

  it('withdrawal frees the registry space but keeps serving existing adopters', async () => {
    // The load-bearing asymmetry: every read path hides a withdrawn sheet
    // except /css, which is the whole reason this is a soft delete.
    const author = await createUser();
    const adopter = await createUser();
    const sheet = await createAuthorStylesheet(author.id, {
      name: 'Withdrawn',
      source: 'a { color: green; }'
    });
    await adoptAuthorStylesheet(adopter.id, sheet.id);

    await deleteAuthorStylesheet(sheet.id, author.id);

    // Still rendering for the adopter who already points at it.
    const served = await getAuthorStylesheetCss(sheet.id);
    expect(served?.source).toBe('a { color: green; }');
    expect(await activeSlotOf(adopter.id)).toBe(sheet.id);

    // Gone from the list, and from the total the quota reads.
    const [rows, total] = await listAuthorStylesheets(author.id, page());
    expect(rows).toHaveLength(0);
    expect(total).toBe(0);

    // Gone from the edit-path read.
    expect(await getAuthorStylesheetById(sheet.id)).toBeNull();

    // And cannot be newly adopted by anyone else.
    const latecomer = await createUser();
    await expect(adoptAuthorStylesheet(latecomer.id, sheet.id)).rejects.toThrow(
      'Author stylesheet not found'
    );
  });

  it('withdrawal releases a space the rank quota was holding', async () => {
    // #146 enforced a ceiling with no way to free one — a one-way ratchet.
    const author = await createUser();
    await testPrisma.userRank.update({
      where: { id: author.userRankId },
      data: { authorStylesheetLimit: 1 }
    });

    const first = await createAuthorStylesheet(author.id, {
      name: 'One',
      source: 'a {}'
    });
    await expect(
      createAuthorStylesheet(author.id, { name: 'Two', source: 'b {}' })
    ).rejects.toThrow('Author stylesheet limit reached (1)');

    await deleteAuthorStylesheet(first.id, author.id);

    // The space is reclaimable now, which is the point of filtering the count.
    const second = await createAuthorStylesheet(author.id, {
      name: 'Two',
      source: 'b {}'
    });
    expect(second.id).not.toBe(first.id);
  });

  it('leaves the CRS ledger alone when a sheet is withdrawn', async () => {
    // Those adoptions were earned. PRD-03's marginal tier table eases an
    // author's score down as live counts fall; it does not re-rate history.
    const author = await createUser();
    const adopter = await createUser();
    const sheet = await createAuthorStylesheet(author.id, {
      name: 'Earned',
      source: 'a {}'
    });
    await adoptAuthorStylesheet(adopter.id, sheet.id);

    const before = await testPrisma.economyTransaction.count({
      where: { reason: 'CRS_STYLESHEET_ADOPTION' }
    });
    await deleteAuthorStylesheet(sheet.id, author.id);
    const after = await testPrisma.economyTransaction.count({
      where: { reason: 'CRS_STYLESHEET_ADOPTION' }
    });

    expect(before).toBe(1);
    expect(after).toBe(1);
  });

  it('refuses a withdrawal from someone who is not the author', async () => {
    const author = await createUser();
    const stranger = await createUser();
    const sheet = await createAuthorStylesheet(author.id, {
      name: 'Mine',
      source: 'a {}'
    });

    await expect(deleteAuthorStylesheet(sheet.id, stranger.id)).rejects.toThrow(
      'Not your stylesheet'
    );
  });
});

describe('AuthorStylesheet adopt → score (PRD-03 #119/#120)', () => {
  it('adopt points the adopter Site slot at the sheet and credits the author', async () => {
    const author = await createUser();
    const adopter = await createUser();
    const sheet = await createAuthorStylesheet(author.id, {
      name: 'Midnight',
      source: 'body { background: #000; }'
    });

    const before = await getReputation(author.id);
    const beforeStyle = before.dimensions.find(
      (d) => d.name === 'stylesheet'
    )!.subScore;

    const result = await adoptAuthorStylesheet(adopter.id, sheet.id);
    expect(result.scored).toBe(true);

    // #119 — adopter's Site Stylesheet slot now reflects the author's sheet.
    expect(await activeSlotOf(adopter.id)).toBe(sheet.id);

    // #120 — exactly one ledger row, crediting the author, actor = adopter.
    const ledger = await testPrisma.economyTransaction.findMany({
      where: { reason: 'CRS_STYLESHEET_ADOPTION' }
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].userId).toBe(author.id);
    expect(ledger[0].actorUserId).toBe(adopter.id);

    // Author CRS reflects the accrued adoption.
    const after = await getReputation(author.id);
    const afterStyle = after.dimensions.find(
      (d) => d.name === 'stylesheet'
    )!.subScore;
    expect(afterStyle).toBeGreaterThan(beforeStyle);
  });

  it('re-adopting the same author is idempotent — no second ledger row', async () => {
    const author = await createUser();
    const adopter = await createUser();
    const sheetA = await createAuthorStylesheet(author.id, {
      name: 'A',
      source: 'a {}'
    });
    const sheetB = await createAuthorStylesheet(author.id, {
      name: 'B',
      source: 'b {}'
    });

    const first = await adoptAuthorStylesheet(adopter.id, sheetA.id);
    expect(first.scored).toBe(true);
    // Switch to another sheet by the SAME author — slot updates cleanly...
    const second = await adoptAuthorStylesheet(adopter.id, sheetB.id);
    expect(second.scored).toBe(false); // ...but no new (adopter, author) credit
    expect(await activeSlotOf(adopter.id)).toBe(sheetB.id);

    const ledger = await testPrisma.economyTransaction.count({
      where: { reason: 'CRS_STYLESHEET_ADOPTION' }
    });
    expect(ledger).toBe(1);
  });

  it('concurrent double-adopt credits the author exactly once (F1: partial unique index)', async () => {
    const author = await createUser();
    const adopter = await createUser();
    const sheet = await createAuthorStylesheet(author.id, {
      name: 'Race',
      source: 'r {}'
    });

    // Two simultaneous adopts (a double-click). Without the DB-level partial
    // unique index both check-then-insert would pass and double-credit; with
    // it, the loser raises P2002 and is swallowed as scored: false.
    const [a, b] = await Promise.all([
      adoptAuthorStylesheet(adopter.id, sheet.id),
      adoptAuthorStylesheet(adopter.id, sheet.id)
    ]);

    // Exactly one of the two recorded a credit.
    expect([a.scored, b.scored].filter(Boolean)).toHaveLength(1);

    const ledger = await testPrisma.economyTransaction.count({
      where: { reason: 'CRS_STYLESHEET_ADOPTION' }
    });
    expect(ledger).toBe(1);
  });

  it('self-adoption renders the sheet but credits nothing (anti-farm)', async () => {
    const author = await createUser();
    const sheet = await createAuthorStylesheet(author.id, {
      name: 'Mine',
      source: 'c {}'
    });

    const result = await adoptAuthorStylesheet(author.id, sheet.id);
    expect(result.scored).toBe(false);
    expect(await activeSlotOf(author.id)).toBe(sheet.id); // own sheet still active

    const ledger = await testPrisma.economyTransaction.count({
      where: { reason: 'CRS_STYLESHEET_ADOPTION' }
    });
    expect(ledger).toBe(0);
  });
});
