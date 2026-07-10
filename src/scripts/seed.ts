/**
 * Boot seed — the compiled entrypoint the container runs after `migrate deploy`
 * (docker-entrypoint.sh). Applies the idempotent baseline (seedAll) so a fresh
 * deploy comes up with ranks / forums / Golden Rules / the System user /
 * stylesheet fixtures already present and /install immediately usable — instead
 * of an empty database that needs a manual `docker compose exec api npm run
 * db:seed` before the first SysOp can be created.
 *
 * Runs from dist/ against prod dependencies only (no ts-node), which is why the
 * seed sequence lives in compiled src/modules and not in prisma/seed.ts. Exits
 * non-zero on failure so the fail-fast entrypoint (`set -e`) surfaces a bad
 * deploy as a crash-loop rather than a silently unusable API.
 */
import { PrismaClient } from '@prisma/client';
import { seedAll } from '../modules/seedAll';

async function main() {
  const prisma = new PrismaClient();
  try {
    await seedAll(prisma);
    console.log('[seed] Baseline data present.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[seed] Failed:', e);
  process.exit(1);
});
