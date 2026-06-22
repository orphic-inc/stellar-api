/**
 * Integration tests for the dev tools test-data generator.
 *
 * These tests call module functions directly against the real test DB
 * (configured via STELLAR_PSQL_URI_TEST in .env.test).
 *
 * Setup: truncateAll() + seedDefaults() before each test.
 * Teardown: testPrisma.$disconnect() after all tests.
 */

import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { runGeneration, resolveConfig } from '../modules/devTools/index';
import type { SectionKey } from '../modules/devTools/types';
import { cleanupRun } from '../modules/devTools/cleanup';

// Minimal isolated config — fast, no forum
const MINIMAL_ISOLATED = {
  preset: 'minimal' as const,
  mode: 'isolated' as const,
  seed: 1337,
  scale: 0.5,
  sections: [
    'users',
    'communities',
    'releases',
    'contributions',
    'collages',
    'requests',
    'wiki'
  ] as SectionKey[],
  includeEdgeCases: false,
  includeModerationData: false,
  includeStatsData: false,
  dryRun: false
};

let actorId: number;

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();

  // Create a minimal actor user required by runGeneration
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const actor = await testPrisma.user.create({
    data: {
      username: 'devtools-actor',
      email: 'actor@example.com',
      password: 'x',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
  actorId = actor.id;
  // truncateAll + seed + a few inserts, run before every test in the suite that
  // generates the most data. It can run slow (not hung) when the CI box is
  // loaded or a prior test's fire-and-forget query still holds a lock the
  // truncate waits on; the original 30s ceiling tipped over there (#165). 60s of
  // headroom absorbs that variance without masking a genuine hang.
}, 60_000);

afterAll(async () => {
  await testPrisma.$disconnect();
});

// ─── Status / Env ─────────────────────────────────────────────────────────────

describe('resolveConfig', () => {
  it('applies defaults when no config fields are provided', () => {
    const cfg = resolveConfig({});
    expect(cfg.preset).toBe('balanced');
    expect(cfg.mode).toBe('isolated');
    expect(cfg.seed).toBe(42);
    expect(cfg.scale).toBe(1);
    expect(cfg.includeEdgeCases).toBe(true);
  });

  it('clamps scale to [0.1, 10]', () => {
    expect(resolveConfig({ scale: 0 }).scale).toBe(0.1);
    expect(resolveConfig({ scale: 999 }).scale).toBe(10);
  });

  it('includes all sections when sections is not specified', () => {
    const cfg = resolveConfig({});
    expect(cfg.sections.size).toBeGreaterThan(5);
  });
});

// ─── Generation ───────────────────────────────────────────────────────────────

describe('runGeneration — minimal isolated', () => {
  it('creates entities and DevSeedRecord rows for each', async () => {
    const result = await runGeneration(MINIMAL_ISOLATED, actorId);

    expect(result.dryRun).toBe(false);
    expect(result.runId).not.toBe('dry-run');

    // Summary counts must be positive for core sections
    expect(result.summary['User']).toBeGreaterThan(0);
    expect(result.summary['Community']).toBeGreaterThan(0);
    expect(result.summary['Release']).toBeGreaterThan(0);

    // DevSeedRun record must exist
    const run = await testPrisma.devSeedRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { _count: { select: { records: true } } }
    });
    expect(run.cleanupStatus).toBe('active');
    expect(run._count.records).toBeGreaterThan(0);

    // DevSeedRecord count must match at least User + Community + Release
    const userRecords = await testPrisma.devSeedRecord.count({
      where: { runId: result.runId, entityType: 'User' }
    });
    expect(userRecords).toBe(result.summary['User']);

    const communityRecords = await testPrisma.devSeedRecord.count({
      where: { runId: result.runId, entityType: 'Community' }
    });
    expect(communityRecords).toBe(result.summary['Community']);
  }, 120_000);

  it('stamps generated users with the seeded-avatar sentinel the UI maps', async () => {
    const result = await runGeneration(MINIMAL_ISOLATED, actorId);

    const records = await testPrisma.devSeedRecord.findMany({
      where: { runId: result.runId, entityType: 'User' },
      select: { primaryKey: true }
    });
    // primaryKey is JSON: { id: <number> } for User records.
    const ids = records.map((r) => (r.primaryKey as { id: number }).id);
    const users = await testPrisma.user.findMany({
      where: { id: { in: ids } },
      select: { avatar: true }
    });

    // Contract: generated users carry the 'seeded' sentinel so stellar-ui's
    // avatarSrc() maps them to the distinct seeded.png (not the shared default).
    // Must stay in sync with SEEDED_AVATAR_SENTINEL in stellar-ui
    // src/utils/avatar.ts. (Regression: the generator briefly stored null,
    // making seeded users indistinguishable from real null-avatar accounts.)
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) expect(u.avatar).toBe('seeded');
  }, 120_000);

  it('dry run returns estimates without writing any rows', async () => {
    const result = await runGeneration(
      { ...MINIMAL_ISOLATED, dryRun: true },
      actorId
    );

    expect(result.dryRun).toBe(true);
    expect(result.runId).toBe('dry-run');

    // No DevSeedRun created
    const runCount = await testPrisma.devSeedRun.count();
    expect(runCount).toBe(0);

    // No users created (only the actor)
    const userCount = await testPrisma.user.count();
    expect(userCount).toBe(1); // only the actor
  }, 30_000);

  it('generation is deterministic: same seed → same counts', async () => {
    const r1 = await runGeneration(MINIMAL_ISOLATED, actorId);
    await cleanupRun(testPrisma, r1.runId);

    const r2 = await runGeneration(MINIMAL_ISOLATED, actorId);
    await cleanupRun(testPrisma, r2.runId);

    // Same seed must produce same summary counts
    expect(r1.summary).toEqual(r2.summary);
  }, 240_000);
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

describe('cleanupRun — isolated mode', () => {
  it('deletes all generated rows and marks run as cleaned', async () => {
    const result = await runGeneration(MINIMAL_ISOLATED, actorId);
    const { runId } = result;

    const cleanup = await cleanupRun(testPrisma, runId);

    if (cleanup.failedItems.length > 0) {
      console.error(
        'Cleanup failedItems:',
        JSON.stringify(cleanup.failedItems, null, 2)
      );
    }
    expect(cleanup.status).toBe('cleaned');
    expect(cleanup.failedItems).toHaveLength(0);

    // All generated users gone (only actor remains)
    const remaining = await testPrisma.user.count({
      where: { email: { endsWith: '@seed.invalid' } }
    });
    expect(remaining).toBe(0);

    // All generated communities gone
    const communities = await testPrisma.community.count();
    expect(communities).toBe(0);

    // Run cleanupStatus updated
    const run = await testPrisma.devSeedRun.findUniqueOrThrow({
      where: { id: runId }
    });
    expect(run.cleanupStatus).toBe('cleaned');
  }, 120_000);

  it('is idempotent: calling cleanup twice succeeds', async () => {
    const result = await runGeneration(MINIMAL_ISOLATED, actorId);
    const { runId } = result;

    const first = await cleanupRun(testPrisma, runId);
    if (first.failedItems.length > 0) {
      console.error(
        'First cleanup failedItems:',
        JSON.stringify(first.failedItems, null, 2)
      );
    }
    expect(first.status).toBe('cleaned');

    // Second cleanup — all rows already gone, should still succeed
    const second = await cleanupRun(testPrisma, runId);
    expect(second.status).toBe('cleaned');
    expect(second.failedItems).toHaveLength(0);
  }, 120_000);

  it('does not delete non-generated users', async () => {
    // Create a real user (not seed data)
    const rank = await testPrisma.userRank.findFirstOrThrow();
    const s = await testPrisma.userSettings.create({ data: {} });
    const p = await testPrisma.profile.create({ data: {} });
    const realUser = await testPrisma.user.create({
      data: {
        username: 'real-user',
        email: 'real@example.com',
        password: 'x',
        userRankId: rank.id,
        userSettingsId: s.id,
        profileId: p.id
      }
    });

    const result = await runGeneration(MINIMAL_ISOLATED, actorId);
    await cleanupRun(testPrisma, result.runId);

    // Real user must still exist
    const exists = await testPrisma.user.findUnique({
      where: { id: realUser.id }
    });
    expect(exists).not.toBeNull();
  }, 120_000);
});

// ─── Multiple runs ────────────────────────────────────────────────────────────

describe('multiple runs', () => {
  it('second run with same seed succeeds without unique constraint errors', async () => {
    const r1 = await runGeneration(MINIMAL_ISOLATED, actorId);
    expect(r1.runId).not.toBe('dry-run');

    // Second run — should not throw despite same seed (runOffset prevents collisions)
    const r2 = await runGeneration(MINIMAL_ISOLATED, actorId);
    expect(r2.runId).not.toBe('dry-run');
    expect(r2.runId).not.toBe(r1.runId);

    // Clean both up
    await cleanupRun(testPrisma, r1.runId);
    await cleanupRun(testPrisma, r2.runId);
  }, 240_000);
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('post-generation validation', () => {
  it('passes with zero errors after minimal isolated generation', async () => {
    const result = await runGeneration(MINIMAL_ISOLATED, actorId);
    expect(result.validation.passed).toBe(true);
    const failed = result.validation.checks.filter((c) => !c.passed);
    expect(failed).toHaveLength(0);

    await cleanupRun(testPrisma, result.runId);
  }, 120_000);
});
