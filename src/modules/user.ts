import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { AppError } from '../lib/errors';

export type SnatchItem = {
  id: number;
  release: { id: number; title: string; communityId: number | null };
  artist: { name: string } | null;
  downloadedAt: Date;
};

export const getUserSettings = async (userId: number) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { userSettingsId: true }
  });
  if (!user) return null;
  return prisma.userSettings.findUnique({ where: { id: user.userSettingsId } });
};

export const updateUserSettings = async (
  userId: number,
  data: {
    siteAppearance?: string;
    externalStylesheet?: string;
    styledTooltips?: boolean;
    paranoia?: number;
    avatar?: string;
    notificationMethod?:
      | 'Disabled'
      | 'Popup'
      | 'Traditional'
      | 'Push'
      | 'Combined';
    showEmail?: boolean;
    showLastSeen?: boolean;
    showContributedStats?: boolean;
    showConsumedStats?: boolean;
    showRatioStats?: boolean;
  }
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { userSettingsId: true }
  });
  if (!user) return null;

  const [settings] = await prisma.$transaction([
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
        }),
        ...(data.paranoia !== undefined && { paranoia: data.paranoia }),
        ...(data.notificationMethod !== undefined && {
          notificationMethod: data.notificationMethod
        }),
        ...(data.showEmail !== undefined && { showEmail: data.showEmail }),
        ...(data.showLastSeen !== undefined && {
          showLastSeen: data.showLastSeen
        }),
        ...(data.showContributedStats !== undefined && {
          showContributedStats: data.showContributedStats
        }),
        ...(data.showConsumedStats !== undefined && {
          showConsumedStats: data.showConsumedStats
        }),
        ...(data.showRatioStats !== undefined && {
          showRatioStats: data.showRatioStats
        })
      }
    }),
    ...(data.avatar !== undefined
      ? [
          prisma.user.update({
            where: { id: userId },
            data: { avatar: data.avatar }
          })
        ]
      : [])
  ]);
  return { ...settings, avatar: data.avatar };
};

export const createUser = async (
  data: {
    username: string;
    email: string;
    password: string;
    userRankId?: number;
  },
  actorId: number
) => {
  const rankId =
    data.userRankId ??
    (await prisma.userRank.findFirst({ where: { level: 100 } }))?.id;
  if (!rankId)
    throw new AppError(
      503,
      'Server misconfigured: default rank missing. Run setup.'
    );

  const hashedPassword = await bcrypt.hash(
    data.password,
    await bcrypt.genSalt(10)
  );

  const user = await prisma.$transaction(async (tx) => {
    const settings = await tx.userSettings.create({ data: {} });
    const profile = await tx.profile.create({ data: {} });
    return tx.user.create({
      data: {
        username: data.username,
        email: data.email.toLowerCase(),
        password: hashedPassword,
        avatar: '',
        userRankId: rankId,
        userSettingsId: settings.id,
        profileId: profile.id,
        contributed: 5_368_709_120n // 5 GiB startup buffer
      },
      select: { id: true, username: true, email: true }
    });
  });

  await audit(prisma, actorId, 'user.create', 'User', user.id, {
    username: data.username,
    email: data.email
  });

  return user;
};

export const getSnatchList = async (
  consumerId: number
): Promise<SnatchItem[]> => {
  const grants = await prisma.downloadAccessGrant.findMany({
    where: { consumerId, status: 'COMPLETED' },
    include: {
      contribution: {
        include: {
          release: {
            select: {
              id: true,
              title: true,
              communityId: true,
              artist: { select: { name: true } }
            }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  const seen = new Set<number>();
  const items: SnatchItem[] = [];
  for (const g of grants) {
    const rel = g.contribution.release;
    if (!seen.has(rel.id)) {
      seen.add(rel.id);
      items.push({
        id: g.id,
        release: { id: rel.id, title: rel.title, communityId: rel.communityId },
        artist: rel.artist ?? null,
        downloadedAt: g.createdAt
      });
    }
    if (items.length >= 100) break;
  }
  return items;
};

export const getInviteTree = async (pg: { skip: number; limit: number }) => {
  const [trees, total] = await Promise.all([
    prisma.inviteTree.findMany({
      include: { user: { select: { id: true, username: true } } },
      orderBy: [
        { treeId: 'asc' },
        { treeLevel: 'asc' },
        { treePosition: 'asc' }
      ],
      skip: pg.skip,
      take: pg.limit
    }),
    prisma.inviteTree.count()
  ]);

  const inviterIds = [...new Set(trees.map((t) => t.inviterId))];
  const inviters = await prisma.user.findMany({
    where: { id: { in: inviterIds } },
    select: { id: true, username: true }
  });
  const inviterMap = new Map(inviters.map((u) => [u.id, u]));
  const rows = trees.map((t) => ({
    ...t,
    inviter: inviterMap.get(t.inviterId) ?? null
  }));

  return { rows, total };
};

export const getDuplicateIps = async () => {
  const dupes = await prisma.user.groupBy({
    by: ['lastIp'],
    where: { lastIp: { not: null } },
    _count: { lastIp: true },
    having: { lastIp: { _count: { gt: 1 } } },
    orderBy: { _count: { lastIp: 'desc' } }
  });

  return Promise.all(
    dupes.map(async (d) => {
      const users = await prisma.user.findMany({
        where: { lastIp: d.lastIp! },
        select: {
          id: true,
          username: true,
          dateRegistered: true,
          disabled: true,
          lastLogin: true
        }
      });
      return { ip: d.lastIp!, count: d._count.lastIp, users };
    })
  );
};

export const warnUser = async (
  userId: number,
  warnedById: number,
  reason: string,
  expiresAt?: string
) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'User not found');

  const [warning] = await prisma.$transaction([
    prisma.userWarning.create({
      data: {
        userId,
        warnedById,
        reason,
        ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {})
      }
    }),
    prisma.user.update({
      where: { id: userId },
      data: { warnedTimes: { increment: 1 }, warned: new Date() }
    })
  ]);

  await audit(prisma, warnedById, 'user.warned', 'User', userId, { reason });
  return warning;
};

export const deleteWarning = async (
  userId: number,
  warnId: number
): Promise<void> => {
  const warning = await prisma.userWarning.findUnique({
    where: { id: warnId }
  });
  if (!warning || warning.userId !== userId) {
    throw new AppError(404, 'Warning not found');
  }
  await prisma.userWarning.delete({ where: { id: warnId } });

  const remaining = await prisma.userWarning.count({ where: { userId } });
  if (remaining === 0) {
    await prisma.user.update({ where: { id: userId }, data: { warned: null } });
  }
};

export const setUserRank = async (
  userId: number,
  userRankId: number,
  secondaryRankIds: number[],
  actorId: number
): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'User not found');

  const uniqueSecondaryRankIds = [...new Set(secondaryRankIds)];
  const ranks = await prisma.userRank.findMany({
    where: { id: { in: [userRankId, ...uniqueSecondaryRankIds] } },
    select: { id: true, secondary: true }
  });
  const rankMap = new Map(ranks.map((rank) => [rank.id, rank]));

  const primaryRank = rankMap.get(userRankId);
  if (!primaryRank) throw new AppError(404, 'Rank not found');
  if (primaryRank.secondary) {
    throw new AppError(422, 'Primary rank cannot be a secondary class');
  }

  for (const secondaryRankId of uniqueSecondaryRankIds) {
    const secondaryRank = rankMap.get(secondaryRankId);
    if (!secondaryRank) throw new AppError(404, 'Secondary rank not found');
    if (!secondaryRank.secondary) {
      throw new AppError(
        422,
        'Only secondary-class ranks can be assigned as secondary classes'
      );
    }
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { userRankId } }),
    prisma.userSecondaryRank.deleteMany({ where: { userId } }),
    ...(uniqueSecondaryRankIds.length > 0
      ? [
          prisma.userSecondaryRank.createMany({
            data: uniqueSecondaryRankIds.map((secondaryRankId) => ({
              userId,
              userRankId: secondaryRankId,
              assignedById: actorId
            }))
          })
        ]
      : [])
  ]);

  await audit(prisma, actorId, 'user.rank_changed', 'User', userId, {
    userRankId,
    secondaryRankIds: uniqueSecondaryRankIds
  });
};

export const grantDonorStatus = async (
  userId: number,
  donorRankId: number,
  expiresAt: string | null,
  actorId: number
): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'User not found');

  const donorRank = await prisma.donorRank.findUnique({
    where: { id: donorRankId }
  });
  if (!donorRank) throw new AppError(404, 'Donor rank not found');

  // Explicit expiresAt wins; fall back to the rank's expiresAfterDays if set
  const computedExpiresAt = expiresAt
    ? new Date(expiresAt)
    : donorRank.expiresAfterDays != null
    ? new Date(Date.now() + donorRank.expiresAfterDays * 86_400_000)
    : null;

  await prisma.$transaction([
    prisma.userDonorRank.upsert({
      where: { userId },
      create: {
        userId,
        donorRankId,
        grantedById: actorId,
        ...(computedExpiresAt ? { expiresAt: computedExpiresAt } : {})
      },
      update: {
        donorRankId,
        grantedAt: new Date(),
        grantedById: actorId,
        expiresAt: computedExpiresAt
      }
    }),
    prisma.user.update({ where: { id: userId }, data: { isDonor: true } })
  ]);

  await audit(prisma, actorId, 'user.donor_granted', 'User', userId);
};

export const getUserIpHistory = async (
  userId: number
): Promise<{ ip: string; seenAt: string }[]> => {
  const sessions = await prisma.userSession.findMany({
    where: { userId },
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      lastActiveAt: true,
      revokedAt: true
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  const history = new Map<string, string>();
  for (const session of sessions) {
    if (!session.ipAddress) continue;
    const seenAt = (session.lastActiveAt ?? session.createdAt).toISOString();
    if (!history.has(session.ipAddress)) {
      history.set(session.ipAddress, seenAt);
    }
  }
  return Array.from(history.entries()).map(([ip, seenAt]) => ({ ip, seenAt }));
};

export const updateStaffBio = async (
  userId: number,
  staffBio: string | null,
  actorId: number,
  actorRankId: number,
  isAdmin: boolean
): Promise<void> => {
  if (!isAdmin) {
    const ownRank = await prisma.userRank.findUnique({
      where: { id: actorRankId },
      select: { displayStaff: true }
    });
    if (!ownRank?.displayStaff) throw new AppError(403, 'Permission denied');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true }
  });
  if (!user) throw new AppError(404, 'User not found');

  const normalized = staffBio?.trim() || null;
  await prisma.user.update({
    where: { id: userId },
    data: { staffBio: normalized }
  });
  await audit(prisma, actorId, 'user.staffBio_updated', 'User', userId, {
    staffBio: normalized
  });
};
