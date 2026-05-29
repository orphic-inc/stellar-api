import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { resolveTagName, resolveTagNames } from '../modules/tag';

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

describe('resolveTagName', () => {
  it('returns the name unchanged when no alias exists', async () => {
    const result = await resolveTagName('rock');
    expect(result).toBe('rock');
  });

  it('returns the canonical tag name when an alias exists', async () => {
    const user = await createUser();
    const canonical = await testPrisma.tag.create({
      data: { name: 'hip.hop', occurrences: 0 }
    });
    await testPrisma.tagAlias.create({
      data: { badTag: 'hip-hop', goodTagId: canonical.id, createdById: user.id }
    });
    const result = await resolveTagName('hip-hop');
    expect(result).toBe('hip.hop');
  });
});

describe('resolveTagNames', () => {
  it('returns an empty array for empty input', async () => {
    const result = await resolveTagNames([]);
    expect(result).toEqual([]);
  });

  it('deduplicates tags that map to the same canonical name', async () => {
    const user = await createUser();
    const canonical = await testPrisma.tag.create({
      data: { name: 'electronic', occurrences: 0 }
    });
    await testPrisma.tagAlias.create({
      data: {
        badTag: 'electronic-music',
        goodTagId: canonical.id,
        createdById: user.id
      }
    });
    const result = await resolveTagNames(['electronic-music', 'electronic']);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('electronic');
  });

  it('passes through names with no alias unchanged', async () => {
    const result = await resolveTagNames(['rock', 'jazz', 'ambient']);
    expect(result).toEqual(['rock', 'jazz', 'ambient']);
  });

  it('mixes resolved and unresolved tags', async () => {
    const user = await createUser();
    const canonical = await testPrisma.tag.create({
      data: { name: 'hip.hop', occurrences: 0 }
    });
    await testPrisma.tagAlias.create({
      data: { badTag: 'hip-hop', goodTagId: canonical.id, createdById: user.id }
    });
    const result = await resolveTagNames(['hip-hop', 'rock', 'jazz']);
    expect(result).toContain('hip.hop');
    expect(result).toContain('rock');
    expect(result).toContain('jazz');
    expect(result).not.toContain('hip-hop');
    expect(result).toHaveLength(3);
  });
});
