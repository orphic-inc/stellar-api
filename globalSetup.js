// @ts-check
const { execSync } = require('child_process');
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
      // identifiers can't be parameterised, but dbName comes from our own env var
      await adminClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[integration] Created database: ${dbName}`);
    }
  } finally {
    await adminClient.end();
  }

  // --- 2. Apply migrations ---
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, STELLAR_PSQL_URI: testUrl },
    stdio: 'inherit'
  });
};
