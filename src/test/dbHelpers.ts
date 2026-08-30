import { PrismaClient } from '@prisma/client';
import { drainBackgroundTasks } from '../modules/backgroundTasks';

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
 * Waits for tracked background work first. That drain is what actually keeps
 * this safe: a query still in flight from the previous test holds row locks, and
 * truncating underneath it deadlocks (40P01, #424).
 *
 * The per-table loop is a leftover mitigation, kept only because it is harmless.
 * It does NOT bound the lock set, contrary to what this comment used to claim —
 * the loop runs inside one `DO $$ … $$` block, so it is a single transaction and
 * every ACCESS EXCLUSIVE lock it takes is held until the block commits, exactly
 * like the batched `TRUNCATE a, b, c` form. If anything, acquiring them one at a
 * time widens the window for a cycle, since another connection can take a
 * conflicting lock on a table the loop has not reached yet. It narrowed the odds
 * and was mistaken for a fix; the drain above is the fix.
 */
export const truncateAll = async (): Promise<void> => {
  await drainBackgroundTasks();
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
  // Exactly one default stylesheet, because user creation resolves a theme name
  // from it and since #376 that throws rather than falling back to a literal.
  // Production gets this from migration 20260524120000_stylesheets_seed, but
  // truncateAll wipes migration-planted rows along with everything else, so the
  // invariant has to be restored here or every registration path 500s.
  await testPrisma.stylesheet.create({
    data: {
      name: 'sublime',
      description: 'Default Stellar theme',
      cssUrl: null,
      isDefault: true
    }
  });
};
