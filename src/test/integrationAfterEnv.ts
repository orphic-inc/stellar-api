/**
 * Runs in each integration test file after the framework is installed
 * (setupFilesAfterEnv), so it can register hooks.
 *
 * `truncateAll` drains background work before every test (#424), but nothing
 * drained after a file's LAST test. An upload's post-commit work — the link
 * check, and notification filter matching since #263 — then finished after the
 * file's tests had ended, and Jest reported the queries it logged as "Cannot log
 * after tests are done". Draining here makes every file wait for its own work.
 */
import { drainBackgroundTasks } from '../modules/backgroundTasks';

afterAll(async () => {
  await drainBackgroundTasks();
});
