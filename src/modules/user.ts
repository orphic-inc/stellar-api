import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { AppError } from '../lib/errors';
import { getDefaultStylesheetName } from './stylesheet';
import { primaryArtist, releaseCreditsSelect } from './releaseCredits';
import { computeRatio } from './ratio';
import { CONTAGION_REACH } from './contagion';
import {
  buildInviteSubtree,
  summarizeInviteTree,
  type InviteTreeRow,
  type InviteTreeNode,
  type InviteTreeSummary
} from './inviteTree';

export type SnatchItem = {
  id: number;
  release: { id: number; title: string; communityId: number | null };
  artist: { name: string } | null;
  downloadedAt: Date;
};

export const getUserSettings = async (userId: number) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { userSettingsId: true, ircNick: true }
  });
  if (!user) return null;
  const settings = await prisma.userSettings.findUnique({
    where: { id: user.userSettingsId }
  });
  if (!settings) return null;
  // ircNick holds only a *verified* nick (ADR-0015), so non-null ⇒ verified. We
  // surface it self-only here (this route reads the caller's own settings) so the
  // UI can render "currently linked: X" — the public profile deliberately omits it
  // (paranoia) since it's not in PROFILE_BASE_SELECT (#201).
  return { ...settings, ircNick: user.ircNick };
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
    const defaultTheme = await getDefaultStylesheetName(tx);
    const settings = await tx.userSettings.create({
      data: { siteAppearance: defaultTheme }
    });
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
              credits: releaseCreditsSelect
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
        artist: primaryArtist(rel.credits),
        downloadedAt: g.createdAt
      });
    }
    if (items.length >= 100) break;
  }
  return items;
};

export const getInviteTree = async (pg: { skip: number; limit: number }) => {
  const [rows, total] = await Promise.all([
    prisma.inviteTree.findMany({
      include: {
        user: { select: { id: true, username: true } },
        inviter: { select: { id: true, username: true } }
      },
      orderBy: [{ inviterId: 'asc' }, { userId: 'asc' }],
      skip: pg.skip,
      take: pg.limit
    }),
    prisma.inviteTree.count()
  ]);

  return { rows, total };
};

/** A descendant of some root, enriched with the fields the tree views render. */
export interface InviteSubtreeRow {
  userId: number;
  inviterId: number | null;
  depth: number;
  username: string;
  email: string;
  disabled: boolean;
  isDonor: boolean;
  rankName: string;
  paranoia: number;
  showContributedStats: boolean;
  showConsumedStats: boolean;
  dateRegistered: Date;
  lastLogin: Date | null;
  contributed: bigint;
  consumed: bigint;
}

// Depth guard so a corrupt edge can't make the recursion walk forever.
const MAX_INVITE_TREE_DEPTH = 50;

/**
 * All descendants of `rootUserId` in the invite tree (the root is the anchor,
 * not included). The recursive walk touches only `invite_trees` (topology); the
 * per-member render fields are then fetched type-safely via Prisma.
 */
export const getInviteSubtreeRows = async (
  rootUserId: number
): Promise<InviteSubtreeRow[]> => {
  const edges = await prisma.$queryRaw<
    { userId: number; inviterId: number | null; depth: number }[]
  >`
    WITH RECURSIVE subtree AS (
      SELECT "userId", "inviterId", 1 AS depth
      FROM "invite_trees"
      WHERE "inviterId" = ${rootUserId}
      UNION ALL
      SELECT it."userId", it."inviterId", s.depth + 1
      FROM "invite_trees" it
      JOIN subtree s ON it."inviterId" = s."userId"
      WHERE s.depth < ${MAX_INVITE_TREE_DEPTH}
    )
    SELECT "userId", "inviterId", depth FROM subtree
  `;
  if (!edges.length) return [];

  const meta = new Map(edges.map((e) => [e.userId, e]));
  const users = await prisma.user.findMany({
    where: { id: { in: edges.map((e) => e.userId) } },
    select: {
      id: true,
      username: true,
      email: true,
      disabled: true,
      isDonor: true,
      dateRegistered: true,
      lastLogin: true,
      contributed: true,
      consumed: true,
      userRank: { select: { name: true } },
      userSettings: {
        select: {
          paranoia: true,
          showContributedStats: true,
          showConsumedStats: true
        }
      }
    }
  });

  return users.map((u) => {
    const e = meta.get(u.id);
    return {
      userId: u.id,
      inviterId: e?.inviterId ?? null,
      depth: e ? Number(e.depth) : 1,
      username: u.username,
      email: u.email,
      disabled: u.disabled,
      isDonor: u.isDonor,
      rankName: u.userRank?.name ?? '',
      paranoia: u.userSettings?.paranoia ?? 0,
      showContributedStats: u.userSettings?.showContributedStats ?? true,
      showConsumedStats: u.userSettings?.showConsumedStats ?? true,
      dateRegistered: u.dateRegistered,
      lastLogin: u.lastLogin,
      contributed: u.contributed,
      consumed: u.consumed
    };
  });
};

/**
 * Distances (1 = direct inviter) UP a member's invite chain to each *infected*
 * ancestor, capped at `CONTAGION_REACH`. Feeds the `inviteContagion` CRS
 * dimension (#155 / ADR-0004 §3): an infected ancestor drags a descendant's
 * score, decaying by distance. "Infected" today = `banned` (User.banDate set);
 * the confirmed-evasion trunk stays a dormant seam until that model lands.
 */
export const getInfectedAncestorDistances = async (
  userId: number
): Promise<number[]> => {
  const ancestors = await prisma.$queryRaw<
    { inviterId: number; depth: number }[]
  >`
    WITH RECURSIVE chain AS (
      SELECT "inviterId", 1 AS depth
      FROM "invite_trees"
      WHERE "userId" = ${userId} AND "inviterId" IS NOT NULL
      UNION ALL
      SELECT it."inviterId", c.depth + 1
      FROM "invite_trees" it
      JOIN chain c ON it."userId" = c."inviterId"
      WHERE c.depth < ${CONTAGION_REACH} AND it."inviterId" IS NOT NULL
    )
    SELECT "inviterId", depth FROM chain
  `;
  if (!ancestors.length) return [];

  const banned = await prisma.user.findMany({
    where: {
      id: { in: ancestors.map((a) => a.inviterId) },
      banDate: { not: null }
    },
    select: { id: true }
  });
  const bannedIds = new Set(banned.map((u) => u.id));
  return ancestors
    .filter((a) => bannedIds.has(a.inviterId))
    .map((a) => Number(a.depth));
};

export interface InviteTreeViewNode {
  userId: number;
  username: string;
  rankName: string;
  isDonor: boolean;
  disabled: boolean;
  depth: number;
  /** Null when the member's stats are paranoia-hidden from this viewer. */
  stats: { contributed: string; consumed: string; ratio: string } | null;
  children: InviteTreeViewNode[];
}

/**
 * A member's invite subtree + summary, ready to serve. `canOverridePrivacy`
 * (staff with `invites_manage`) sees every member's byte stats; otherwise a
 * member's stats show only with their consent — but the aggregate totals always
 * include everyone (an inviter is answerable for their whole tree's footprint).
 */
export const getMemberInviteTreeView = async (
  rootUserId: number,
  canOverridePrivacy: boolean
): Promise<{ tree: InviteTreeViewNode[]; summary: InviteTreeSummary }> => {
  const rows = await getInviteSubtreeRows(rootUserId);
  const treeRows: InviteTreeRow[] = rows.map((r) => ({
    userId: r.userId,
    inviterId: r.inviterId,
    username: r.username,
    disabled: r.disabled,
    rankName: r.rankName,
    isDonor: r.isDonor,
    contributed: r.contributed,
    consumed: r.consumed,
    statsVisible:
      canOverridePrivacy || (r.showContributedStats && r.showConsumedStats)
  }));

  const nodes = buildInviteSubtree(treeRows, rootUserId);
  const serialize = (ns: InviteTreeNode[]): InviteTreeViewNode[] =>
    ns.map((n) => ({
      userId: n.userId,
      username: n.username,
      rankName: n.rankName,
      isDonor: n.isDonor,
      disabled: n.disabled,
      depth: n.depth,
      stats: n.statsVisible
        ? {
            contributed: n.contributed.toString(),
            consumed: n.consumed.toString(),
            ratio: computeRatio(n.contributed, n.consumed).toFixed(2)
          }
        : null,
      children: serialize(n.children)
    }));

  return { tree: serialize(nodes), summary: summarizeInviteTree(nodes) };
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
