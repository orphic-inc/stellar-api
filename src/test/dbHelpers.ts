import { PrismaClient } from '@prisma/client';

const testUrl = process.env.STELLAR_PSQL_URI_TEST!;

export const testPrisma = new PrismaClient({
  datasources: { db: { url: testUrl } },
  log: []
});

/** Truncates every table (except _prisma_migrations) and resets sequences. */
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
