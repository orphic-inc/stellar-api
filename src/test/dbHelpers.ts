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
 * Batched into ONE `TRUNCATE a, b, c` rather than a per-table loop, because this
 * runs in `beforeEach` for every integration test: ~126 tables x ~185 tests was
 * ~23,000 separate TRUNCATE statements per CI run, each taking its own lock and
 * doing its own relation-file work. That is an almost purely I/O-bound workload,
 * which is why a contended runner inflated the whole suite 4-16x rather than
 * uniformly a little (#458's 68-minute run; #165 was the same shape in June and
 * was "fixed" by raising the hook timeout, which only moved which suite trips
 * first).
 *
 * The loop this replaces was a leftover mitigation for the #424 deadlock, and
 * the comment it carried already said it was not load-bearing: the loop ran
 * inside one `DO $$ … $$` block, so it was a single transaction holding every
 * ACCESS EXCLUSIVE lock until commit — exactly like the batched form. If
 * anything the loop was *worse* for deadlocks, since acquiring locks one at a
 * time widens the window for another connection to take a conflicting one on a
 * table the loop has not reached yet. The drain above is, and remains, the fix.
 */
export const truncateAll = async (): Promise<void> => {
  await drainBackgroundTasks();
  await testPrisma.$executeRawUnsafe(`
    DO $$ DECLARE tables text; BEGIN
      SELECT string_agg(quote_ident(tablename), ', ')
        INTO tables
        FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
      -- Null when the schema has no tables yet; EXECUTE on it would be invalid SQL.
      IF tables IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
      END IF;
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
