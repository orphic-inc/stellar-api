/**
 * Dev seed — recreates default user ranks and forum structure so the /install
 * flow is available after a database reset.  Does NOT create users; complete
 * the install flow at http://localhost:3000/install after running this.
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

// minClassRead 200 = Power User+; 0 = everyone
const FORUM_STRUCTURE = [
  {
    name: 'Site',
    sort: 10,
    forums: [
      {
        sort: 10,
        name: 'Announcements',
        description: 'Official site announcements.'
      },
      {
        sort: 20,
        name: 'Stellar',
        description: 'News and updates about the Stellar project.'
      },
      {
        sort: 30,
        name: 'Bugs',
        description: 'Report bugs and technical issues.'
      },
      {
        sort: 40,
        name: 'Projects',
        description: 'Ongoing and upcoming projects.'
      }
    ]
  },
  {
    name: 'Suggestions',
    sort: 20,
    forums: [
      {
        sort: 10,
        name: 'The Laboratory',
        description: 'Experimental ideas and early proposals.'
      },
      {
        sort: 20,
        name: 'Suggestions/Ideas',
        description: 'Feature requests and suggestions.'
      },
      {
        sort: 30,
        name: 'Contests & Designs',
        description: 'Community contests and design submissions.'
      },
      {
        sort: 40,
        name: 'First Line Support',
        description: 'Peer-to-peer support from the community.'
      }
    ]
  },
  {
    name: 'Community',
    sort: 30,
    forums: [
      {
        sort: 10,
        name: 'The Lounge',
        description: 'General off-topic discussion.'
      },
      {
        sort: 20,
        name: 'The Library',
        description: 'Books, articles, and reading recommendations.'
      },
      {
        sort: 30,
        name: 'Power User',
        description: 'Power User discussion area.',
        minClassRead: 200,
        minClassWrite: 200
      },
      {
        sort: 40,
        name: 'Technology',
        description: 'Technology, software, and hardware.'
      },
      {
        sort: 50,
        name: 'Concerts & Events',
        description: 'Live events, concerts, and meetups.'
      }
    ]
  },
  {
    name: 'Music',
    sort: 40,
    forums: [
      { sort: 10, name: 'Music', description: 'General music discussion.' },
      {
        sort: 20,
        name: 'Vanity House',
        description: 'Share your own music and productions.'
      },
      {
        sort: 30,
        name: 'The Studio',
        description: 'Production, mixing, and recording techniques.'
      },
      {
        sort: 40,
        name: 'Offered',
        description: 'Share and exchange music recommendations.'
      }
    ]
  },
  {
    name: 'Help',
    sort: 50,
    forums: [
      {
        sort: 10,
        name: 'Help',
        description: 'Get help with site usage and your account.'
      }
    ]
  },
  {
    name: 'Trash',
    sort: 60,
    forums: [
      {
        sort: 10,
        name: 'Trash',
        description: 'Moved or removed topics.',
        isTrash: true
      }
    ]
  }
];

async function seedRanks() {
  const existing = await prisma.userRank.count();
  if (existing > 0) {
    console.log(`Skipping ranks — ${existing} user rank(s) already exist.`);
    return;
  }
  for (const rank of DEFAULT_RANKS) {
    await prisma.userRank.create({ data: rank });
  }
  console.log(`Seeded ${DEFAULT_RANKS.length} default user ranks.`);
}

async function seedForums() {
  const existing = await prisma.forumCategory.count();
  if (existing > 0) {
    console.log(
      `Skipping forums — ${existing} forum category(s) already exist.`
    );
    return;
  }
  let totalForums = 0;
  for (const cat of FORUM_STRUCTURE) {
    const category = await prisma.forumCategory.create({
      data: { name: cat.name, sort: cat.sort }
    });
    for (const f of cat.forums) {
      await prisma.forum.create({
        data: {
          forumCategoryId: category.id,
          sort: f.sort,
          name: f.name,
          description: f.description,
          minClassRead: (f as { minClassRead?: number }).minClassRead ?? 0,
          minClassWrite: (f as { minClassWrite?: number }).minClassWrite ?? 0,
          isTrash: (f as { isTrash?: boolean }).isTrash ?? false
        }
      });
      totalForums++;
    }
  }
  console.log(
    `Seeded ${FORUM_STRUCTURE.length} categories and ${totalForums} forums.`
  );
}

async function main() {
  await seedRanks();
  await seedForums();
  console.log('→ Complete setup at http://localhost:3000/install');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
