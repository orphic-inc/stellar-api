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

export const canAccessForumLevel = (
  user:
    | { userRankLevel: number; permittedForumIds?: number[] }
    | null
    | undefined,
  forumId: number,
  requiredLevel: number | null | undefined
): boolean =>
  !!user &&
  (user.userRankLevel >= (requiredLevel ?? 0) ||
    !!user.permittedForumIds?.includes(forumId));
