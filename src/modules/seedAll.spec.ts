/**
 * seedAll is a thin orchestrator, but it owns two real invariants the individual
 * seeders can't enforce alone:
 *
 *   - the System user must be seeded *before* the fixtures it owns — stylesheets
 *     and wiki pages alike — and its returned id must be the one they are
 *     authored under; a reorder or a wrong id would seed orphaned fixtures;
 *   - theme assets must be stored *before* the stylesheets referencing them
 *     (#341), or an asset-bearing theme is briefly served with dangling
 *     `/api/asset` targets.
 *
 * Both are pure ordering facts invisible to the seeders themselves — pin that
 * wiring here.
 */
import type { PrismaClient } from '@prisma/client';

const seedRanks = jest.fn();
const seedRankPromotionRules = jest.fn();
const seedForums = jest.fn();
const seedSystemUser = jest.fn();
const seedGoldenRules = jest.fn();
const seedStylesheetFixtures = jest.fn();
const seedAssetFixtures = jest.fn();
const seedWikiFixtures = jest.fn();

const SYSTEM_USER_ID = 4242;

jest.mock('./bootstrap', () => ({
  seedRanks: (...a: unknown[]) => seedRanks(...a),
  seedRankPromotionRules: (...a: unknown[]) => seedRankPromotionRules(...a),
  seedForums: (...a: unknown[]) => seedForums(...a),
  seedSystemUser: (...a: unknown[]) => seedSystemUser(...a)
}));
jest.mock('./goldenRules', () => ({
  seedGoldenRules: (...a: unknown[]) => seedGoldenRules(...a)
}));
jest.mock('./assetFixtures', () => ({
  seedAssetFixtures: (...a: unknown[]) => seedAssetFixtures(...a)
}));
jest.mock('./stylesheetFixtures', () => ({
  seedStylesheetFixtures: (...a: unknown[]) => seedStylesheetFixtures(...a)
}));
jest.mock('./wikiFixtures', () => ({
  seedWikiFixtures: (...a: unknown[]) => seedWikiFixtures(...a)
}));

import { seedAll } from './seedAll';

describe('seedAll', () => {
  const client = {} as PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    // Set here, not at module load: the suite's mock config resets
    // implementations between tests.
    seedSystemUser.mockResolvedValue(SYSTEM_USER_ID);
  });

  it('runs every baseline seeder once against the given client', async () => {
    await seedAll(client);
    for (const fn of [
      seedRanks,
      seedRankPromotionRules,
      seedForums,
      seedGoldenRules,
      seedSystemUser,
      seedAssetFixtures,
      seedStylesheetFixtures,
      seedWikiFixtures
    ]) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls[0][0]).toBe(client);
    }
  });

  it('seeds the System user before the fixtures it owns, passing its id through', async () => {
    await seedAll(client);
    expect(seedSystemUser.mock.invocationCallOrder[0]).toBeLessThan(
      seedStylesheetFixtures.mock.invocationCallOrder[0]
    );
    expect(seedSystemUser.mock.invocationCallOrder[0]).toBeLessThan(
      seedWikiFixtures.mock.invocationCallOrder[0]
    );
    // Fixtures are authored under exactly the id seedSystemUser returned.
    expect(seedStylesheetFixtures).toHaveBeenCalledWith(client, SYSTEM_USER_ID);
    expect(seedWikiFixtures).toHaveBeenCalledWith(client, SYSTEM_USER_ID);
  });

  it('stores theme assets before the stylesheets that reference them', async () => {
    await seedAll(client);
    expect(seedAssetFixtures.mock.invocationCallOrder[0]).toBeLessThan(
      seedStylesheetFixtures.mock.invocationCallOrder[0]
    );
  });
});
