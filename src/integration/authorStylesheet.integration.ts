import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  createAuthorStylesheet,
  listAuthorStylesheets,
  adoptAuthorStylesheet
} from '../modules/authorStylesheet';
import { getReputation } from '../modules/reputation';

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

describe('AuthorStylesheet save → list (PRD-03 #118, many per author)', () => {
  it('an author can save several stylesheets and list them all', async () => {
    const author = await createUser();
    await createAuthorStylesheet(author.id, { name: 'First', source: 'a {}' });
    await createAuthorStylesheet(author.id, { name: 'Second', source: 'b {}' });

    const all = await listAuthorStylesheets(author.id);
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.name)).toEqual(['First', 'Second']);
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
