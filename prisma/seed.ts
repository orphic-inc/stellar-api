/**
 * Seed — recreates default user ranks, forum structure, Golden Rules, the
 * System user, and stylesheet fixtures so the /install flow is available after
 * a database reset. Does NOT create users; complete the one-time install to
 * mint the first SysOp afterwards, either through the UI install page (default
 * http://localhost:9000/install when stellar-ui is running) or directly against
 * the API: POST http://localhost:${STELLAR_HTTP_PORT:-8080}/api/install.
 *
 * Runs automatically after `prisma migrate dev` resets the database, and can be
 * run manually with `npm run db:seed`. The container runs the same sequence on
 * boot via src/scripts/seed.ts — both call seedAll(), the single source of truth.
 */
import { PrismaClient } from '@prisma/client';
import { seedAll } from '../src/modules/seedAll';

const prisma = new PrismaClient();

async function main() {
  await seedAll(prisma);
  const port = process.env.STELLAR_HTTP_PORT || '8080';
  console.log(
    `→ Seed complete. Create the first SysOp via the UI install page ` +
      `(http://localhost:9000/install with stellar-ui running) or POST ` +
      `http://localhost:${port}/api/install directly.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
