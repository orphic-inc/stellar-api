/**
 * Runs before each integration test file (setupFiles).
 * Redirects STELLAR_PSQL_URI to the test DB and clears the globalThis
 * prisma singleton so lib/prisma.ts re-initialises with the test URL.
 */
const testUrl = process.env.STELLAR_PSQL_URI_TEST;
if (!testUrl) {
  throw new Error('STELLAR_PSQL_URI_TEST must be set for integration tests');
}

process.env.STELLAR_PSQL_URI = testUrl;

// Suppress background jobs (link health, stats, donor expiry) in integration
// tests — they would start timers that outlive the test suite and cause Jest
// to warn about open handles.
process.env.DISABLE_BACKGROUND_JOBS = '1';

// The lib/prisma singleton is cached on globalThis. Clearing it here forces a
// fresh PrismaClient (pointing at the test DB) when modules load below.
(globalThis as { prisma?: unknown }).prisma = undefined;
