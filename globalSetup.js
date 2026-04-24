// @ts-check
const { execFileSync } = require('child_process');
const { Client } = require('pg');

/**
 * Runs once before all integration tests.
 * 1. Creates the test database if it does not exist.
 * 2. Applies all pending Prisma migrations.
 */
module.exports = async function globalSetup() {
  const testUrl = process.env.STELLAR_PSQL_URI_TEST;
  if (!testUrl) {
    throw new Error(
      'STELLAR_PSQL_URI_TEST is required to run integration tests.\n' +
        'Example: STELLAR_PSQL_URI_TEST=postgresql://user:pass@localhost:5432/stellar_test'
    );
  }

  // --- 1. Create the database if it does not exist ---
  const parsed = new URL(testUrl);
  const dbName = parsed.pathname.replace(/^\//, '');
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
    throw new Error(
      `STELLAR_PSQL_URI_TEST must use a simple database name, got: ${dbName}`
    );
  }
  const adminClient = new Client({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: parsed.username,
    password: parsed.password,
    database: 'postgres'
  });

  await adminClient.connect();
  try {
    const { rows } = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );
    if (rows.length === 0) {
      await adminClient.end();
      execFileSync(
        'createdb',
        [
          '--host',
          parsed.hostname,
          '--port',
          parsed.port || '5432',
          '--username',
          parsed.username,
          dbName
        ],
        {
          env: { ...process.env, PGPASSWORD: parsed.password },
          stdio: 'inherit'
        }
      );
      console.log(`[integration] Created database: ${dbName}`);
    }
  } finally {
    try {
      await adminClient.end();
    } catch {
      // ignore double-close after createdb path
    }
  }

  // --- 2. Apply migrations ---
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, STELLAR_PSQL_URI: testUrl },
    stdio: 'inherit'
  });
};
