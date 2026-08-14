/**
 * Tracking for work deliberately started outside the request path.
 *
 * Several handlers kick off follow-up work without awaiting it — a ratio-policy
 * evaluation after a download grant, a link check after a contribution — so a
 * failure there cannot roll back or slow the response that already succeeded.
 * That part is intentional and stays.
 *
 * What was missing is any handle on the resulting promise. An untracked query
 * outlives the request that started it, which in tests means it is still holding
 * row locks when the next test's `truncateAll` starts issuing `TRUNCATE`, and the
 * two deadlock (40P01, #424). Registering the promise here costs nothing at
 * runtime and gives tests something to wait on.
 */

const pending = new Set<Promise<unknown>>();

/**
 * Runs `p` in the background, tracked.
 *
 * Pass a promise that already carries its own error handling — every call site
 * attaches a `.catch` that logs. This only observes settlement.
 *
 * Note the cleanup uses `then(fn, fn)` rather than `finally(fn)`: `finally`
 * returns a *new* promise that re-rejects when `p` rejects, and nothing handles
 * that derived promise, so a rejecting task produced an unhandled rejection that
 * surfaced against whichever test happened to be running. Passing the same
 * callback as both handlers settles the derived chain either way.
 */
export const runInBackground = (p: Promise<unknown>): void => {
  const forget = (): void => {
    pending.delete(p);
  };
  pending.add(p);
  void p.then(forget, forget);
};

/**
 * Resolves once every tracked task has settled.
 *
 * Loops rather than awaiting once: a draining task can register another (a link
 * check that schedules a recheck), and those late arrivals hold locks just the
 * same. `allSettled` because a rejected task is still finished — its error is the
 * caller's business, not the drain's.
 */
export const drainBackgroundTasks = async (): Promise<void> => {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
};

/** Number of tasks still in flight. Test/diagnostic use. */
export const pendingBackgroundTaskCount = (): number => pending.size;
