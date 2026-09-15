/**
 * Ratio policy sweep (#646, ADR-0044 §4–5) — applies the ratio rules on a clock
 * to members whose state can go stale without a download. The rules live in the
 * pure `ratioPolicyRules.ts`; the claim, audit row and PM in `ratioPolicy.ts`,
 * shared with the post-download evaluation.
 *
 * Three things here are deliberate and not obvious from the issue:
 *
 *  - It walks only `WATCH` and `DOWNLOAD_DISABLED` / `RATIO` rows. A `STAFF`
 *    disable never lifts, and starting a watch stays download-triggered, so an
 *    `OK` row has nothing the sweep may do.
 *  - There is no mode switch (see `config.ratioPolicy`). A transition this makes
 *    is one the next download would have made anyway.
 *  - One evaluation per member, each caught on its own. A bad row is logged and
 *    skipped; it cannot abort the cycle for every member behind it. Each
 *    evaluation claims its own transaction, so a staff override racing the
 *    sweep wins.
 */
import { RatioDisableCause, RatioPolicyStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getLogger } from './logging';
import { ratioPolicy as ratioPolicyConfig } from './config';
import { applyRatioRules } from './ratioPolicy';
import type { RatioTransition } from './ratioPolicyRules';

const log = getLogger('ratioPolicyJob');

const STARTUP_DELAY_MS = 150_000;
export const BATCH_SIZE = 500;

/** The rows the sweep may move. */
export const sweepableRatioStateWhere = {
  OR: [
    { status: RatioPolicyStatus.WATCH },
    {
      status: RatioPolicyStatus.DOWNLOAD_DISABLED,
      disabledCause: RatioDisableCause.RATIO
    }
  ]
};

export type RatioSweepTally = Record<RatioTransition['kind'], number> & {
  evaluated: number;
  failed: number;
};

/**
 * Keyed on `userId > cursor` rather than a Prisma cursor: moved rows leave the
 * where set as the cycle runs, and a bare `take` would re-read the same first
 * batch whenever a row in it failed.
 */
const loadBatch = (after: number) =>
  prisma.ratioPolicyState.findMany({
    where: { ...sweepableRatioStateWhere, userId: { gt: after } },
    select: { userId: true },
    orderBy: [{ userId: 'asc' }],
    take: BATCH_SIZE
  });

const evaluateOne = async (
  userId: number,
  now: Date,
  tally: RatioSweepTally
): Promise<void> => {
  try {
    const transition = await applyRatioRules(userId, 'sweep', now);
    tally.evaluated += 1;
    if (transition) tally[transition.kind] += 1;
  } catch (err) {
    tally.failed += 1;
    log.error('Ratio policy sweep failed for a member', { userId, err });
  }
};

export const runRatioPolicyCycle = async (
  now: Date = new Date()
): Promise<RatioSweepTally> => {
  const tally: RatioSweepTally = {
    evaluated: 0,
    watch_started: 0,
    watch_cleared: 0,
    download_disabled: 0,
    download_restored: 0,
    failed: 0
  };

  let after = 0;
  for (;;) {
    const batch = await loadBatch(after);
    for (const { userId } of batch) {
      await evaluateOne(userId, now, tally);
    }
    if (batch.length < BATCH_SIZE) break;
    after = batch[batch.length - 1].userId;
  }

  log.info('Ratio policy cycle complete', tally);
  return tally;
};

export const startRatioPolicyJob = (): void => {
  const run = () =>
    void runRatioPolicyCycle().catch((err) =>
      log.error('Ratio policy cycle failed', { err })
    );

  const outer = setTimeout(() => {
    run();
    setInterval(run, ratioPolicyConfig.intervalMs).unref();
  }, STARTUP_DELAY_MS);
  outer.unref();

  log.info('Ratio policy job scheduled', {
    intervalMs: ratioPolicyConfig.intervalMs
  });
};
