/**
 * Unit tests for the background-task tracker.
 */

import {
  runInBackground,
  drainBackgroundTasks,
  pendingBackgroundTaskCount
} from './backgroundTasks';

const tick = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('runInBackground / drainBackgroundTasks', () => {
  afterEach(async () => {
    await drainBackgroundTasks();
  });

  it('drain waits for a task that settles later', async () => {
    let done = false;
    runInBackground(
      tick(20).then(() => {
        done = true;
      })
    );

    expect(done).toBe(false);
    await drainBackgroundTasks();
    expect(done).toBe(true);
  });

  it('drain waits for tasks registered by a draining task', async () => {
    // The case the loop exists for: a link check that schedules a recheck. A
    // single `allSettled` would return before the second task ran, and the
    // second task holds locks exactly like the first.
    let inner = false;
    runInBackground(
      tick(10).then(() => {
        runInBackground(
          tick(10).then(() => {
            inner = true;
          })
        );
      })
    );

    await drainBackgroundTasks();
    expect(inner).toBe(true);
    expect(pendingBackgroundTaskCount()).toBe(0);
  });

  it('a rejecting task settles the drain without escaping', async () => {
    // The call sites attach their own .catch, so a tracked promise is normally
    // already handled — but the drain must not turn a rejection into a failure
    // of whatever awaited it.
    runInBackground(tick(5).then(() => Promise.reject(new Error('boom'))));

    await expect(drainBackgroundTasks()).resolves.toBeUndefined();
    expect(pendingBackgroundTaskCount()).toBe(0);
  });

  it('drain on an empty set resolves immediately', async () => {
    expect(pendingBackgroundTaskCount()).toBe(0);
    await expect(drainBackgroundTasks()).resolves.toBeUndefined();
  });

  it('forgets tasks once they settle', async () => {
    runInBackground(tick(5));
    expect(pendingBackgroundTaskCount()).toBe(1);

    await drainBackgroundTasks();
    expect(pendingBackgroundTaskCount()).toBe(0);
  });
});
