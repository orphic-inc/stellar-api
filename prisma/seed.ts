/**
 * Dev seed — recreates the default user ranks so the /install flow is
 * available after a database reset.  Does NOT create users; complete the
 * install flow at http://localhost:3000/install after running this.
 *
 * Runs automatically after `prisma migrate dev` resets the database.
 * Can also be run manually: npx prisma db seed
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_RANKS = [
  {
    level: 100,
    name: 'User',
    color: '',
    badge: '',
    permissions: { forums_read: true, forums_post: true }
  },
  {
    level: 200,
    name: 'Power User',
    color: '#e2a822',
    badge: '',
    permissions: { forums_read: true, forums_post: true }
  },
  {
    level: 500,
    name: 'Staff',
    color: '#e22a2a',
    badge: '',
    permissions: {
      forums_read: true,
      forums_post: true,
      forums_moderate: true,
      forums_manage: true,
      communities_manage: true,
      news_manage: true,
      invites_manage: true,
      users_edit: true,
      users_warn: true,
      users_disable: true,
      staff: true
    }
  },
  {
    level: 1000,
    name: 'SysOp',
    color: '#a0d468',
    badge: '',
    permissions: {
      forums_read: true,
      forums_post: true,
      forums_moderate: true,
      forums_manage: true,
      communities_manage: true,
      news_manage: true,
      invites_manage: true,
      users_edit: true,
      users_warn: true,
      users_disable: true,
      staff: true,
      admin: true
    }
  }
];

async function main() {
  const existing = await prisma.userRank.count();
  if (existing > 0) {
    console.log(`Skipping seed — ${existing} user rank(s) already exist.`);
    return;
  }

  for (const rank of DEFAULT_RANKS) {
    await prisma.userRank.create({ data: rank });
  }
  console.log(`Seeded ${DEFAULT_RANKS.length} default user ranks.`);
  console.log('→ Complete setup at http://localhost:3000/install');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
