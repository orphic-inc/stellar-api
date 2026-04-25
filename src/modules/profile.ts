import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { sanitizeHtml, sanitizePlain } from '../lib/sanitize';

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
      uploaded: bigint;
      downloaded: bigint;
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
      uploaded: row.user.uploaded.toString(),
      downloaded: row.user.downloaded.toString(),
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

export const updateProfile = async (
  userId: number,
  data: {
    avatar?: string;
    avatarMouseoverText?: string;
    profileTitle?: string;
    profileInfo?: string;
    siteAppearance?: string;
    externalStylesheet?: string;
    styledTooltips?: boolean;
  }
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { profileId: true, userSettingsId: true }
  });
  if (!user) return null;

  await prisma.$transaction([
    prisma.profile.update({
      where: { id: user.profileId },
      data: {
        ...(data.avatar !== undefined && {
          avatar: sanitizePlain(data.avatar)
        }),
        ...(data.avatarMouseoverText !== undefined && {
          avatarMouseoverText: sanitizePlain(data.avatarMouseoverText)
        }),
        ...(data.profileTitle !== undefined && {
          profileTitle: sanitizePlain(data.profileTitle)
        }),
        ...(data.profileInfo !== undefined && {
          profileInfo: sanitizeHtml(data.profileInfo)
        })
      }
    }),
    prisma.userSettings.update({
      where: { id: user.userSettingsId },
      data: {
        ...(data.siteAppearance !== undefined && {
          siteAppearance: data.siteAppearance
        }),
        ...(data.externalStylesheet !== undefined && {
          externalStylesheet: data.externalStylesheet
        }),
        ...(data.styledTooltips !== undefined && {
          styledTooltips: data.styledTooltips
        })
      }
    })
  ]);

  return getCurrentProfile(userId);
};

type CreateInviteResult =
  | { ok: true; inviteKey: string }
  | { ok: false; reason: 'no_invites' | 'already_invited' };

export const createInvite = async (
  inviterId: number,
  email: string,
  reason: string
): Promise<CreateInviteResult> => {
  const inviter = await prisma.user.findUnique({
    where: { id: inviterId },
    select: { inviteCount: true }
  });
  if (!inviter || inviter.inviteCount <= 0) {
    return { ok: false, reason: 'no_invites' };
  }

  const existing = await prisma.invite.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, reason: 'already_invited' };
  }

  const inviteKey = crypto.randomBytes(20).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.invite.create({
      data: {
        inviterId,
        inviteKey,
        email: sanitizePlain(email),
        expires,
        reason: sanitizePlain(reason)
      }
    }),
    prisma.user.update({
      where: { id: inviterId },
      data: { inviteCount: { decrement: 1 } }
    })
  ]);

  return { ok: true, inviteKey };
};
