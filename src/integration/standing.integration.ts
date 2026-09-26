import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { getProfileById } from '../modules/profile';
import { authorRefSelect, toAuthorRef } from '../modules/authorRef';
import { authUserSelect, toAuthUser } from '../modules/auth';

// PRD-05 #2 / ADR-0004 — standing surfaced on the profile read path, computed from
// seeded warned/banned users against the real DB. Ladder logic is unit-tested in
// modules/standing.spec.ts; this proves the wiring (select + compute + expose).

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let staffId: number;

const createUser = async (
  username: string,
  data: Record<string, unknown> = {}
) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username,
      email: `${username}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      ...data
    }
  });
};

const warn = (userId: number, expiresAt: Date | null) =>
  testPrisma.userWarning.create({
    data: { userId, warnedById: staffId, reason: 'test', expiresAt }
  });

const YEAR_AGO = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
const NEXT_YEAR = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const LAST_YEAR = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

beforeEach(async () => {
  const staff = await createUser('staffer');
  staffId = staff.id;
});

describe('standing on the profile read path', () => {
  it('is pristine for a long-tenured, never-warned user', async () => {
    const u = await createUser('clean-vet', { dateRegistered: YEAR_AGO });
    const view = await getProfileById(u.id, u.id, { showMature: true });
    expect(view?.standing).toBe('pristine');
  });

  it('is clean for a fresh, never-warned user', async () => {
    const u = await createUser('newbie');
    const view = await getProfileById(u.id, u.id, { showMature: true });
    expect(view?.standing).toBe('clean');
  });

  it('is poor for a user with two active warnings', async () => {
    const u = await createUser('two-strikes', { dateRegistered: YEAR_AGO });
    await warn(u.id, null);
    await warn(u.id, NEXT_YEAR);
    const view = await getProfileById(u.id, u.id, { showMature: true });
    expect(view?.standing).toBe('poor');
  });

  it('ignores expired warnings — recovers toward pristine', async () => {
    const u = await createUser('reformed', { dateRegistered: YEAR_AGO });
    await warn(u.id, LAST_YEAR); // expired
    await warn(u.id, LAST_YEAR); // expired
    const view = await getProfileById(u.id, u.id, { showMature: true });
    expect(view?.standing).toBe('pristine');
  });

  it('is the hammer for a banned user regardless of warnings', async () => {
    const u = await createUser('banned-acct', {
      dateRegistered: YEAR_AGO,
      banDate: new Date()
    });
    const view = await getProfileById(u.id, u.id, { showMature: true });
    expect(view?.standing).toBe('hammer');
  });
});

// #719 — the warning sign reads the same active rows as standing, on every
// read path. `User.warned` is set the way warnUser leaves it: stamped, and
// never cleared by expiry. That is exactly the state that used to leak.
describe('the warning sign on the read paths (#719)', () => {
  const WEEK_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const readAll = async (userId: number) => {
    const [view, author, session] = await Promise.all([
      getProfileById(userId, userId, { showMature: true }),
      testPrisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: authorRefSelect
      }),
      testPrisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: authUserSelect
      })
    ]);
    return {
      profileWarned: view?.warned,
      authorWarned: toAuthorRef(author).warned,
      warnedUntil: toAuthUser(session).warnedUntil
    };
  };

  it('drops the sign once every warning has expired', async () => {
    const u = await createUser('expired', { warned: WEEK_AGO });
    await warn(u.id, LAST_YEAR);

    expect(await readAll(u.id)).toEqual({
      profileWarned: null,
      authorWarned: null,
      warnedUntil: null
    });
  });

  it('shows the sign and its end for a dated active warning', async () => {
    const u = await createUser('dated', { warned: WEEK_AGO });
    const w = await warn(u.id, NEXT_YEAR);

    expect(await readAll(u.id)).toEqual({
      profileWarned: w.createdAt.toISOString(),
      authorWarned: w.createdAt.toISOString(),
      warnedUntil: NEXT_YEAR.toISOString()
    });
  });

  it('shows the sign with no end for a permanent warning', async () => {
    const u = await createUser('permanent', { warned: WEEK_AGO });
    const w = await warn(u.id, null);

    expect(await readAll(u.id)).toEqual({
      profileWarned: w.createdAt.toISOString(),
      authorWarned: w.createdAt.toISOString(),
      warnedUntil: null
    });
  });
});
