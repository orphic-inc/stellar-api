/**
 * Dev seed — recreates default user ranks and forum structure so the /install
 * flow is available after a database reset.  Does NOT create users; complete
 * the install flow at http://localhost:9000/install after running this.
 *
 * Runs automatically after `prisma migrate dev` resets the database.
 * Can also be run manually: npx prisma db seed
 */
import { PrismaClient } from '@prisma/client';
import {
  seedRanks,
  seedRankPromotionRules,
  seedForums,
  seedSystemUser
} from '../src/modules/bootstrap';
import { seedGoldenRules } from '../src/modules/goldenRules';
import { seedStylesheetFixtures } from '../src/modules/stylesheetFixtures';

const prisma = new PrismaClient();

async function main() {
  await seedRanks(prisma);
  await seedRankPromotionRules(prisma);
  await seedForums(prisma);
  await seedGoldenRules(prisma);
  // System user must precede the stylesheet fixtures it owns (needs ranks first).
  const systemUserId = await seedSystemUser(prisma);
  await seedStylesheetFixtures(prisma, systemUserId);
  console.log('→ Complete setup at http://localhost:9000/install');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
