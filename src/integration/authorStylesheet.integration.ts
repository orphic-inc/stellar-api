import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  upsertAuthorStylesheet,
  getAuthorStylesheet
} from '../modules/authorStylesheet';

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
  return testPrisma.user.create({
    data: {
      username: `user-${Date.now()}-${Math.random()}`,
      email: `user-${Date.now()}-${Math.random()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

describe('AuthorStylesheet save → fetch (PRD-03 #118)', () => {
  it('round-trips: save then read back the same source', async () => {
    const user = await createUser();
    await upsertAuthorStylesheet(user.id, {
      name: 'Midnight',
      source: 'body { background: #000; }'
    });

    const fetched = await getAuthorStylesheet(user.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Midnight');
    expect(fetched!.source).toBe('body { background: #000; }');
    expect(fetched!.authorId).toBe(user.id);
  });

  it('is one-per-author: re-saving replaces in place, never duplicates', async () => {
    const user = await createUser();
    await upsertAuthorStylesheet(user.id, { name: 'First', source: 'a {}' });
    await upsertAuthorStylesheet(user.id, { name: 'Second', source: 'b {}' });

    const all = await testPrisma.authorStylesheet.findMany({
      where: { authorId: user.id }
    });
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Second');
    expect(all[0].source).toBe('b {}');
  });

  it('returns null for an author with no stylesheet', async () => {
    const user = await createUser();
    expect(await getAuthorStylesheet(user.id)).toBeNull();
  });
});
