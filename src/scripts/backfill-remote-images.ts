/**
 * The remote image backfill (#738, ADR-0051 §6). Run it once, and it must
 * report clean, before deploying the stellar-ui release that closes `img-src`
 * (stellar-ui#402). An image not yet imported then renders only as a link.
 *
 *   npm run images:backfill                                        # dev
 *   docker compose exec api node dist/scripts/backfill-remote-images.js
 *
 * Options:
 *   --wait-minutes=N  how long to keep importing before reporting (default
 *                     90; retries back off for over an hour in all)
 *   --no-wait         queue and report without importing
 *
 * Exits 0 when nothing is pending, 1 while any URL still is, and 2 on error.
 * Failed imports do not change the exit code; the report lists each one.
 * Safe to re-run: it queues nothing already known and changes no owner.
 */
import { PrismaClient } from '@prisma/client';
import { SYSTEM_USERNAME } from '../modules/bootstrap';
import {
  formatBackfillReport,
  runBackfill
} from '../modules/remoteImageBackfill';

const DEFAULT_WAIT_MINUTES = 90;

function waitMinutes(argv: string[]): number | null {
  if (argv.includes('--no-wait')) return null;
  const arg = argv.find((a) => a.startsWith('--wait-minutes='));
  const minutes = arg ? Number(arg.split('=')[1]) : DEFAULT_WAIT_MINUTES;
  if (!Number.isFinite(minutes) || minutes < 0)
    throw new Error(`--wait-minutes must be a number of minutes: ${arg}`);
  return minutes;
}

async function main(): Promise<number> {
  const minutes = waitMinutes(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const system = await prisma.user.findUnique({
      where: { username: SYSTEM_USERNAME },
      select: { id: true }
    });
    if (!system)
      throw new Error(
        'No System user; the boot seed creates it. Run it first.'
      );
    const drain =
      minutes === null ? null : { deadline: Date.now() + minutes * 60_000 };
    const report = await runBackfill(prisma, system.id, drain);
    console.log(formatBackfillReport(report));
    return report.pending > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  }
);
