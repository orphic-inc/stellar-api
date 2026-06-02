/**
 * One-off backfill: clear stored Gravatar avatar URLs.
 *
 * Gravatar was removed because it leaks a hash of the user's email to a third
 * party (Automattic) on every avatar render — unacceptable for a private site.
 * New users register with a null avatar and the UI falls back to the bundled
 * default. This nulls existing Gravatar URLs so already-registered users stop
 * leaking and pick up the same default.
 *
 * Idempotent — re-running is a no-op once the URLs are cleared.
 *
 * Run:  npx ts-node prisma/scripts/backfill-remove-gravatar-avatars.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const GRAVATAR_MATCHES = ['gravatar.com', 'gravatar.test'];

async function main() {
  const where = {
    OR: GRAVATAR_MATCHES.map((needle) => ({
      avatar: { contains: needle }
    }))
  };

  const [users, profiles] = await prisma.$transaction([
    prisma.user.updateMany({ where, data: { avatar: null } }),
    prisma.profile.updateMany({ where, data: { avatar: null } })
  ]);

  console.log(
    `Cleared Gravatar avatars — ${users.count} user(s), ${profiles.count} profile(s).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
