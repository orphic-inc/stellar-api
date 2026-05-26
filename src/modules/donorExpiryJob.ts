import { prisma } from '../lib/prisma';
import { getLogger } from './logging';

const log = getLogger('donorExpiryJob');

const INTERVAL_MS = 60 * 60 * 1000; // hourly
const STARTUP_DELAY_MS = 30_000;

const sweepExpiredDonors = async (): Promise<void> => {
  const now = new Date();

  // Delete by condition (not by userId) so a staff re-grant that creates a
  // fresh non-expired row is never touched. The transaction ensures the
  // isDonor cleanup sees the post-delete state.
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.userDonorRank.deleteMany({
      where: { expiresAt: { lte: now } }
    });

    if (count === 0) return;

    // Only clear isDonor for users who now have no remaining active grant.
    // If staff re-granted between the deleteMany and this update, the new
    // row keeps the user's isDonor flag intact.
    await tx.$executeRaw`
      UPDATE "users"
      SET "is_donor" = false
      WHERE "is_donor" = true
        AND NOT EXISTS (
          SELECT 1 FROM "user_donor_ranks" WHERE "user_id" = "users"."id"
        )
    `;

    log.info('Swept expired donor ranks', { count });
  });
};

export const startDonorExpiryJob = (): void => {
  const outer = setTimeout(() => {
    sweepExpiredDonors().catch((err) =>
      log.error('Donor expiry sweep failed', { err })
    );
    setInterval(() => {
      sweepExpiredDonors().catch((err) =>
        log.error('Donor expiry sweep failed', { err })
      );
    }, INTERVAL_MS).unref();
  }, STARTUP_DELAY_MS);
  outer.unref();

  log.info('Donor expiry job scheduled', {
    startupDelayMs: STARTUP_DELAY_MS,
    intervalMs: INTERVAL_MS
  });
};
