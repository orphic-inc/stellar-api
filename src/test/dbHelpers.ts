import { PrismaClient } from '@prisma/client';

const testUrl = process.env.STELLAR_PSQL_URI_TEST!;

// Annotated as canonical `PrismaClient`: without it the inferred type is the
// non-canonical `PrismaClient<{datasources, log}>` instantiation, and every
// call site taking a `PrismaClient` parameter pays a full structural compare
// of the entire client (~29s in one integration test alone, #306 trace).
export const testPrisma: PrismaClient = new PrismaClient({
  datasources: { db: { url: testUrl } },
  log: []
});

/**
 * Truncates every table (except _prisma_migrations) and resets sequences.
 *
 * Deliberately a per-table loop, NOT a single `TRUNCATE a, b, c … CASCADE`: the
 * batched form takes ACCESS EXCLUSIVE locks on every table at once, which
 * deadlocks (40P01) under CI when a prior test's fire-and-forget query (e.g. the
 * downloads ratio-policy eval) still holds a lock. Truncating one table at a
 * time keeps the lock set per statement small enough to avoid that. The #165
 * flake was setup running slow under load, not this being wrong — the fix is the
 * hook-timeout headroom in devTools.integration.ts, not batching the locks.
 */
export const truncateAll = async (): Promise<void> => {
  await testPrisma.$executeRawUnsafe(`
    DO $$ DECLARE r RECORD; BEGIN
      FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      ) LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
};

/** Inserts the minimum seed data required by most business logic. */
export const seedDefaults = async (): Promise<void> => {
  await testPrisma.userRank.create({
    data: { level: 100, name: 'User', permissions: {} }
  });
};
