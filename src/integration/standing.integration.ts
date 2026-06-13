import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { getProfileById } from '../modules/profile';

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
    const view = await getProfileById(u.id, u.id);
    expect(view?.standing).toBe('pristine');
  });

  it('is clean for a fresh, never-warned user', async () => {
    const u = await createUser('newbie');
    const view = await getProfileById(u.id, u.id);
    expect(view?.standing).toBe('clean');
  });

  it('is poor for a user with two active warnings', async () => {
    const u = await createUser('two-strikes', { dateRegistered: YEAR_AGO });
    await warn(u.id, null);
    await warn(u.id, NEXT_YEAR);
    const view = await getProfileById(u.id, u.id);
    expect(view?.standing).toBe('poor');
  });

  it('ignores expired warnings — recovers toward pristine', async () => {
    const u = await createUser('reformed', { dateRegistered: YEAR_AGO });
    await warn(u.id, LAST_YEAR); // expired
    await warn(u.id, LAST_YEAR); // expired
    const view = await getProfileById(u.id, u.id);
    expect(view?.standing).toBe('pristine');
  });

  it('is the hammer for a banned user regardless of warnings', async () => {
    const u = await createUser('banned-acct', {
      dateRegistered: YEAR_AGO,
      banDate: new Date()
    });
    const view = await getProfileById(u.id, u.id);
    expect(view?.standing).toBe('hammer');
  });
});
