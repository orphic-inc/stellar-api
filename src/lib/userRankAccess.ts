import { prisma } from './prisma';
import { normalizePermissions, type PermissionMap } from './rankPermissions';

type RankSlice = {
  id: number;
  level: number;
  permissions: unknown;
  permittedForumIds: number[];
};

type UserRankAccessRow = {
  userRankId: number;
  userRank: RankSlice | null;
  secondaryRanks: Array<{
    userRankId: number;
    userRank: RankSlice;
  }>;
};

export type UserRankAccess = {
  userRankId: number;
  effectiveLevel: number;
  permissions: PermissionMap;
  permittedForumIds: number[];
  secondaryRankIds: number[];
};

const mergeRankPermissions = (ranks: RankSlice[]): PermissionMap => {
  const merged: PermissionMap = {};
  for (const rank of ranks) {
    Object.assign(
      merged,
      normalizePermissions(rank.permissions as Record<string, boolean> | null)
    );
  }
  return merged;
};

export const computeUserRankAccess = (
  user: UserRankAccessRow
): UserRankAccess => {
  const primary = user.userRank;
  const secondary = user.secondaryRanks.map((entry) => entry.userRank);
  const allRanks = [primary, ...secondary].filter(Boolean) as RankSlice[];

  const effectiveLevel = allRanks.reduce(
    (maxLevel, rank) => Math.max(maxLevel, rank.level),
    0
  );

  const permittedForumIds = [
    ...new Set(allRanks.flatMap((rank) => rank.permittedForumIds ?? []))
  ].sort((a, b) => a - b);

  return {
    userRankId: user.userRankId,
    effectiveLevel,
    permissions: mergeRankPermissions(allRanks),
    permittedForumIds,
    secondaryRankIds: user.secondaryRanks.map((entry) => entry.userRankId)
  };
};

export const getUserRankAccess = async (
  userId: number
): Promise<UserRankAccess | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      userRankId: true,
      userRank: {
        select: {
          id: true,
          level: true,
          permissions: true,
          permittedForumIds: true
        }
      },
      secondaryRanks: {
        select: {
          userRankId: true,
          userRank: {
            select: {
              id: true,
              level: true,
              permissions: true,
              permittedForumIds: true
            }
          }
        }
      }
    }
  });

  if (!user) return null;
  return computeUserRankAccess(user);
};

/**
 * A member's rank-configured quotas, resolved across their whole rank set.
 * `null` means unlimited.
 */
export type RankQuotas = {
  personalCollageLimit: number | null;
  authorStylesheetLimit: number | null;
};

/**
 * Resolve a nullable rank quota across every rank a member holds (primary +
 * secondary). `0` means none, `null` means unlimited, and a positive N is the
 * cap: the reading `personalCollageLimit` and `authorStylesheetLimit` share
 * with `assetLimit` (#881).
 *
 * Two rules, and the order matters:
 *
 *   - **`null` anywhere wins, and means unlimited.** A plain `Math.max` would
 *     drop it, so a donor perk of 5 would *cap* an unlimited primary rank at 5
 *     (#369).
 *   - otherwise the **highest** cap in the set applies, `0` included, so a
 *     secondary rank can only ever raise a ceiling, never lower one.
 *
 * An empty set is unlimited: a member with no rank row has always been
 * enforced nothing.
 */
export const resolveRankQuota = (limits: (number | null)[]): number | null =>
  limits.length === 0 || limits.some((limit) => limit === null)
    ? null
    : Math.max(...(limits as number[]));

/**
 * Load a member's quotas across primary + secondary ranks. The enforcement-side
 * counterpart to what `toAuthUser` advertises in the auth payload — the two must
 * agree, since a member shown 5 and refused at 3 is quoted a number they were
 * never told (#369, ADR-0032 §4).
 */
export const getUserRankQuotas = async (
  userId: number,
  client: Pick<typeof prisma, 'user'> = prisma
): Promise<RankQuotas> => {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      userRank: {
        select: { personalCollageLimit: true, authorStylesheetLimit: true }
      },
      secondaryRanks: {
        select: {
          userRank: {
            select: { personalCollageLimit: true, authorStylesheetLimit: true }
          }
        }
      }
    }
  });

  const ranks = [
    ...(user?.userRank ? [user.userRank] : []),
    ...(user?.secondaryRanks ?? []).map((entry) => entry.userRank)
  ];

  return {
    personalCollageLimit: resolveRankQuota(
      ranks.map((rank) => rank.personalCollageLimit)
    ),
    authorStylesheetLimit: resolveRankQuota(
      ranks.map((rank) => rank.authorStylesheetLimit)
    )
  };
};

export const canAccessForumLevel = (
  user:
    { userRankLevel: number; permittedForumIds?: number[] } | null | undefined,
  forumId: number,
  requiredLevel: number | null | undefined
): boolean =>
  !!user &&
  (user.userRankLevel >= (requiredLevel ?? 0) ||
    !!user.permittedForumIds?.includes(forumId));
