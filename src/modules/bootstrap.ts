/**
 * Idempotent bootstrap helpers shared by prisma/seed.ts and the install route.
 * Each function is a no-op when the relevant rows already exist.
 */
import { PrismaClient } from '@prisma/client';

export const DEFAULT_RANKS = [
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
] as const;

// minClassRead/Write 200 = Power User+; 0 = everyone; 500 = Staff+
export const FORUM_STRUCTURE = [
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
    name: 'Staff',
    sort: 90,
    forums: [
      {
        sort: 10,
        name: 'Staff',
        description: 'Internal staff discussion.',
        minClassRead: 500,
        minClassWrite: 500
      }
    ]
  },
  {
    name: 'Trash',
    sort: 100,
    forums: [
      {
        sort: 10,
        name: 'Trash',
        description: 'Moved or removed topics.',
        isTrash: true,
        minClassRead: 500,
        minClassWrite: 500,
        minClassCreate: 500
      }
    ]
  }
] as const;

type ForumEntry = {
  sort: number;
  name: string;
  description: string;
  minClassRead?: number;
  minClassWrite?: number;
  minClassCreate?: number;
  isTrash?: boolean;
};

export async function seedRanks(client: PrismaClient): Promise<void> {
  const existing = await client.userRank.count();
  if (existing > 0) return;
  for (const rank of DEFAULT_RANKS) {
    await client.userRank.create({ data: rank });
  }
}

export async function seedForums(client: PrismaClient): Promise<void> {
  const existing = await client.forumCategory.count();
  if (existing > 0) return;
  for (const cat of FORUM_STRUCTURE) {
    const category = await client.forumCategory.create({
      data: { name: cat.name, sort: cat.sort }
    });
    for (const f of cat.forums as readonly ForumEntry[]) {
      await client.forum.create({
        data: {
          forumCategoryId: category.id,
          sort: f.sort,
          name: f.name,
          description: f.description,
          minClassRead: f.minClassRead ?? 0,
          minClassWrite: f.minClassWrite ?? 0,
          minClassCreate: f.minClassCreate ?? 0,
          isTrash: f.isTrash ?? false
        }
      });
    }
  }
}
