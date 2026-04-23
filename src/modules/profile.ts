import { prisma } from '../lib/prisma';

export type InviteTreeNode = {
  id: number;
  username: string;
  email: string;
  joinedAt: string;
  lastSeen: string | null;
  uploaded: string;
  downloaded: string;
  ratio: string;
  children: InviteTreeNode[];
};

const buildInviteTree = (
  rows: Array<{
    treeLevel: number;
    treePosition: number;
    user: {
      id: number;
      username: string;
      email: string;
      dateRegistered: Date;
      lastLogin: Date | null;
      uploaded: number;
      downloaded: number;
      ratio: number;
    };
  }>
): InviteTreeNode[] => {
  if (!rows.length) return [];

  const minLevel = Math.min(...rows.map((row) => row.treeLevel));
  const roots: InviteTreeNode[] = [];
  const stack: Array<{ level: number; node: InviteTreeNode }> = [];

  for (const row of rows.sort((a, b) => a.treePosition - b.treePosition)) {
    const level = Math.max(0, row.treeLevel - minLevel);
    const node: InviteTreeNode = {
      id: row.user.id,
      username: row.user.username,
      email: row.user.email,
      joinedAt: row.user.dateRegistered.toISOString(),
      lastSeen: row.user.lastLogin?.toISOString() ?? null,
      uploaded: String(row.user.uploaded),
      downloaded: String(row.user.downloaded),
      ratio: row.user.ratio.toFixed(2),
      children: []
    };

    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    if (stack.length) {
      stack[stack.length - 1].node.children.push(node);
    } else {
      roots.push(node);
    }

    stack.push({ level, node });
  }

  return roots;
};

export const getCurrentProfile = async (userId: number) => {
  const [user, inviteRows] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        avatar: true,
        profile: true,
        userSettings: true,
        userRank: { select: { name: true, color: true } }
      }
    }),
    prisma.inviteTree.findMany({
      where: { treeId: userId },
      orderBy: { treePosition: 'asc' },
      select: {
        treeLevel: true,
        treePosition: true,
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            dateRegistered: true,
            lastLogin: true,
            uploaded: true,
            downloaded: true,
            ratio: true
          }
        }
      }
    })
  ]);

  if (!user?.profile) return null;

  return {
    ...user,
    inviteTree: buildInviteTree(inviteRows)
  };
};
