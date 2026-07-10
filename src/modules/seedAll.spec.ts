/**
 * seedAll is a thin orchestrator, but it owns one real invariant the individual
 * seeders can't enforce alone: the System user must be seeded *before* the
 * stylesheet fixtures it owns, and its returned id must be the one the fixtures
 * are authored under. A reorder or a wrong id would seed orphaned fixtures — pin
 * that wiring here.
 */
import type { PrismaClient } from '@prisma/client';

const seedRanks = jest.fn();
const seedRankPromotionRules = jest.fn();
const seedForums = jest.fn();
const seedSystemUser = jest.fn();
const seedGoldenRules = jest.fn();
const seedStylesheetFixtures = jest.fn();

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
jest.mock('./stylesheetFixtures', () => ({
  seedStylesheetFixtures: (...a: unknown[]) => seedStylesheetFixtures(...a)
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
      seedStylesheetFixtures
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
    // Fixtures are authored under exactly the id seedSystemUser returned.
    expect(seedStylesheetFixtures).toHaveBeenCalledWith(client, SYSTEM_USER_ID);
  });
});
