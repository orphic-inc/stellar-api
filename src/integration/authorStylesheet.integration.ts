import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  createAuthorStylesheet,
  getAuthorStylesheets
} from '../modules/stylesheet';
import { AppError } from '../lib/errors';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async (username: string) => {
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
      profileId: profile.id
    }
  });
};

describe('AuthorStylesheet (PRD-03 #4a)', () => {
  it('create → fetch round-trips for the owning author', async () => {
    const author = await createUser('themer');

    const created = await createAuthorStylesheet(author.id, {
      name: 'midnight',
      description: 'Dark theme',
      source: 'body { background: #000; }'
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.authorId).toBe(author.id);

    const fetched = await getAuthorStylesheets(author.id);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].name).toBe('midnight');
    expect(fetched[0].source).toBe('body { background: #000; }');
    expect(fetched[0].description).toBe('Dark theme');
  });

  it('lets one author save several distinct named stylesheets', async () => {
    const author = await createUser('themer');

    await createAuthorStylesheet(author.id, {
      name: 'midnight',
      description: '',
      source: 'body {}'
    });
    await createAuthorStylesheet(author.id, {
      name: 'daybreak',
      description: '',
      source: 'body {}'
    });

    const fetched = await getAuthorStylesheets(author.id);
    expect(fetched.map((s) => s.name)).toEqual(['midnight', 'daybreak']);
  });

  it('rejects a duplicate name for the same author (409)', async () => {
    const author = await createUser('themer');

    await createAuthorStylesheet(author.id, {
      name: 'midnight',
      description: '',
      source: 'body {}'
    });

    await expect(
      createAuthorStylesheet(author.id, {
        name: 'midnight',
        description: '',
        source: 'body { color: red; }'
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      createAuthorStylesheet(author.id, {
        name: 'midnight',
        description: '',
        source: 'body {}'
      })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('scopes saved stylesheets to their author', async () => {
    const alice = await createUser('alice');
    const bob = await createUser('bob');

    await createAuthorStylesheet(alice.id, {
      name: 'shared-name',
      description: '',
      source: 'body {}'
    });
    // Same name is allowed for a different author (unique is per-author).
    await createAuthorStylesheet(bob.id, {
      name: 'shared-name',
      description: '',
      source: 'body {}'
    });

    expect(await getAuthorStylesheets(alice.id)).toHaveLength(1);
    expect(await getAuthorStylesheets(bob.id)).toHaveLength(1);
  });
});
