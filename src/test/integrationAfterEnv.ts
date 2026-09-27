/**
 * Runs in each integration test file after the framework is installed
 * (setupFilesAfterEnv), so it can register hooks.
 *
 * `truncateAll` drains background work before every test (#424), but nothing
 * drained after a file's LAST test. An upload's post-commit work — the link
 * check, and notification filter matching since #263 — then finished after the
 * file's tests had ended, and Jest reported the queries it logged as "Cannot log
 * after tests are done". Draining here makes every file wait for its own work.
 *
 * Then the app's client is disconnected. integrationSetup gives every file a
 * fresh `lib/prisma` client, and files disconnect only `testPrisma`, so each
 * file's pool stayed open for the rest of the in-band run. Pools fill lazily,
 * so the leak grew with how parallel a file's module queries were, until the
 * run hit Postgres's `max_connections` and every later file failed (#723).
 * After the drain, because background work still needs the client.
 */
import { drainBackgroundTasks } from '../modules/backgroundTasks';
import { prisma } from '../lib/prisma';

afterAll(async () => {
  await drainBackgroundTasks();
  await prisma.$disconnect();
});
