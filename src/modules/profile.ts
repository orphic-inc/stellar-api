import crypto from 'crypto';
import type {
  NotificationMethod,
  Prisma,
  StaffInboxStatus
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { primaryArtist, releaseCreditsSelect } from './releaseCredits';
import { sanitizePlain } from '../lib/sanitize';
// Profile info is stored as raw BBCode and transcribed at read time via the
// shared render-at-read seam — the API is the single source of transcription
// (#398/#402).
import { renderSiteBBCode } from './bbcodeRender';
import { sendInviteEmail } from '../lib/mailer';
import { getLogger } from './logging';
import { computeRatio } from './ratio';
import { parsePerks, type PerksMap } from './donor';
import { computeStanding } from './standing';
import {
  getInviteSubtreeRows,
  getMemberInviteTreeView,
  type InviteSubtreeRow
} from './user';
import {
  getReputation,
  filterReputationView,
  type CrsResult
} from './reputation';

const DAY_MS = 24 * 60 * 60 * 1000;

const log = getLogger('profile');

type ViewerContext = {
  viewerId: number | null;
  isOwner: boolean;
  isStaff: boolean;
};

type UserSettingsView = {
  id: number;
  siteAppearance: string;
  externalStylesheet: string | null;
  activeAuthorStylesheetId: number | null;
  styledTooltips: boolean;
  paranoia: number;
  notificationMethod: NotificationMethod;
  showEmail: boolean;
  showLastSeen: boolean;
  showContributedStats: boolean;
  showConsumedStats: boolean;
  showRatioStats: boolean;
};

type InviteTreeNode = {
  id: number;
  username: string;
  email?: string;
  joinedAt: string;
  lastSeen: string | null;
  contributed: string;
  consumed: string;
  ratio: string;
  children: InviteTreeNode[];
};

type RecentContribution = {
  id: number;
  createdAt: string;
  release: {
    id: number;
    title: string;
    communityId: number | null;
    image: string | null;
    artist: { id: number; name: string } | null;
  };
};

type RecentSnatch = {
  id: number;
  downloadedAt: string;
  release: {
    id: number;
    title: string;
    communityId: number | null;
  };
  artist: { name: string } | null;
};

type ProfileCollagePreview = {
  id: number;
  name: string;
  categoryId: number;
  isFeatured: boolean;
  numEntries: number;
  createdAt: string;
  updatedAt: string;
  coverImages: string[];
};

type DonorPresentation = {
  rank: {
    name: string;
    badge: string;
    color: string;
    grantedAt: string;
    expiresAt: string | null;
  } | null;
  customIcon: string | null;
  customIconLink: string | null;
  secondAvatar: string | null;
  iconMouseOverText: string | null;
  avatarMouseOverText: string | null;
  profileBlocks: Array<{ title: string; body: string }>;
};

type ProfilePercentile = {
  percentile: number;
  rank: number;
  total: number;
  /**
   * The contributing value behind the percentile. `null` when the viewer's
   * paranoia gate hides that stat outright (contributed/consumed bytes) — the
   * percentile itself stays visible, as it always has.
   */
  raw: number | null;
};

type ProfilePercentileSummary = {
  contributed: ProfilePercentile;
  consumed: ProfilePercentile;
  contributions: ProfilePercentile;
  forumPosts: ProfilePercentile;
  requestsFilled: ProfilePercentile;
  artistsAdded: ProfilePercentile;
  /** Weighted blend of the dimensions above, scaled by ratio. See OVERALL_WEIGHTS. */
  overall: number;
};

type ProfileStaffPmSummary = {
  id: number;
  subject: string;
  status: StaffInboxStatus;
  createdAt: string;
  updatedAt: string;
  assignedStaff: { id: number; username: string } | null;
  replyCount: number;
  viewerCanOpen: boolean;
};

type ProfileStaffPmOverview = {
  total: number;
  unresolved: number;
  recentConversations: ProfileStaffPmSummary[];
};

type ProfileActivitySummary = {
  contributions: number;
  requestsCreated: number;
  requestsFilled: number;
  forumTopics: number;
  forumPosts: number;
  comments: number;
  collagesStarted: number;
  collageEntries: number;
};

const PROFILE_BASE_SELECT = {
  id: true,
  profileId: true,
  username: true,
  email: true,
  avatar: true,
  dateRegistered: true,
  lastLogin: true,
  isArtist: true,
  isDonor: true,
  disabled: true,
  warned: true,
  banDate: true,
  warnings: { select: { expiresAt: true } },
  inviteCount: true,
  staffBio: true,
  contributed: true,
  consumed: true,
  ratio: true,
  userRank: {
    select: {
      id: true,
      name: true,
      color: true,
      badge: true,
      displayStaff: true
    }
  },
  profile: true,
  donorRank: {
    select: {
      grantedAt: true,
      expiresAt: true,
      donorRank: {
        select: {
          name: true,
          badge: true,
          color: true,
          perks: true
        }
      }
    }
  },
  donorReward: {
    select: {
      customIcon: true,
      customIconLink: true,
      secondAvatar: true,
      iconMouseOverText: true,
      avatarMouseOverText: true,
      profileInfoTitle1: true,
      profileInfo1: true,
      profileInfoTitle2: true,
      profileInfo2: true,
      profileInfoTitle3: true,
      profileInfo3: true,
      profileInfoTitle4: true,
      profileInfo4: true
    }
  },
  userSettings: {
    select: {
      id: true,
      siteAppearance: true,
      externalStylesheet: true,
      // The Registry source pointer (ADR-0024 §4): the two sources are the two
      // arms of one radio, so the pointer travels the contract next to the URL.
      activeAuthorStylesheetId: true,
      styledTooltips: true,
      paranoia: true,
      notificationMethod: true,
      showEmail: true,
      showLastSeen: true,
      showContributedStats: true,
      showConsumedStats: true,
      showRatioStats: true
    }
  }
} as const;

type ProfileUserRecord = Prisma.UserGetPayload<{
  select: typeof PROFILE_BASE_SELECT;
}>;

// Nest the flat subtree rows under `rootUserId` by their inviter pointer,
// producing the profile's invite-tree contract. A `seen` set guards a corrupt
// edge from looping; siblings are username-ordered for a stable render.
const buildInviteTree = (
  rows: InviteSubtreeRow[],
  rootUserId: number,
  includeEmail: boolean
): InviteTreeNode[] => {
  const byInviter = new Map<number, InviteSubtreeRow[]>();
  for (const row of rows) {
    if (row.inviterId === null) continue;
    const list = byInviter.get(row.inviterId);
    if (list) list.push(row);
    else byInviter.set(row.inviterId, [row]);
  }

  const seen = new Set<number>([rootUserId]);
  const build = (inviterId: number): InviteTreeNode[] =>
    (byInviter.get(inviterId) ?? [])
      .filter((row) => !seen.has(row.userId))
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((row) => {
        seen.add(row.userId);
        return {
          id: row.userId,
          username: row.username,
          ...(includeEmail ? { email: row.email } : {}),
          joinedAt: row.dateRegistered.toISOString(),
          lastSeen: row.lastLogin?.toISOString() ?? null,
          contributed: row.contributed.toString(),
          consumed: row.consumed.toString(),
          ratio: computeRatio(row.contributed, row.consumed).toFixed(2),
          children: build(row.userId)
        };
      });

  return build(rootUserId);
};

const loadViewerContext = async (
  targetUserId: number,
  viewerUserId?: number
): Promise<ViewerContext> => {
  if (!viewerUserId) {
    return { viewerId: null, isOwner: false, isStaff: false };
  }

  if (viewerUserId === targetUserId) {
    return { viewerId: viewerUserId, isOwner: true, isStaff: false };
  }

  const viewer = await prisma.user.findUnique({
    where: { id: viewerUserId },
    select: {
      userRank: { select: { permissions: true } }
    }
  });
  const perms = (viewer?.userRank.permissions ?? {}) as Record<string, boolean>;
  const isStaff = !!(
    perms.staff ||
    perms.admin ||
    perms.users_edit ||
    perms.users_warn ||
    perms.users_disable
  );

  return { viewerId: viewerUserId, isOwner: false, isStaff };
};

const getActivitySummary = async (
  userId: number
): Promise<ProfileActivitySummary> => {
  const [
    contributions,
    requestsCreated,
    requestsFilled,
    forumTopics,
    forumPosts,
    comments,
    collagesStarted,
    collageEntries
  ] = await Promise.all([
    prisma.contribution.count({ where: { userId } }),
    prisma.request.count({ where: { userId, deletedAt: null } }),
    prisma.request.count({ where: { fillerId: userId, deletedAt: null } }),
    prisma.forumTopic.count({ where: { authorId: userId, deletedAt: null } }),
    prisma.forumPost.count({ where: { authorId: userId, deletedAt: null } }),
    prisma.comment.count({ where: { authorId: userId, deletedAt: null } }),
    prisma.collage.count({ where: { userId, isDeleted: false } }),
    prisma.collageEntry.count({ where: { userId } })
  ]);

  return {
    contributions,
    requestsCreated,
    requestsFilled,
    forumTopics,
    forumPosts,
    comments,
    collagesStarted,
    collageEntries
  };
};

const getRecentContributions = async (
  userId: number
): Promise<RecentContribution[]> => {
  const rows = await prisma.contribution.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      createdAt: true,
      release: {
        select: {
          id: true,
          title: true,
          communityId: true,
          image: true,
          credits: releaseCreditsSelect
        }
      }
    }
  });

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    release: {
      id: row.release.id,
      title: row.release.title,
      communityId: row.release.communityId,
      image: row.release.image,
      artist: primaryArtist(row.release.credits)
    }
  }));
};

const getRecentSnatches = async (userId: number): Promise<RecentSnatch[]> => {
  const grants = await prisma.downloadAccessGrant.findMany({
    where: { consumerId: userId, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
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
    take: 25
  });

  const seen = new Set<number>();
  const items: RecentSnatch[] = [];

  for (const grant of grants) {
    const release = grant.contribution.release;
    if (seen.has(release.id)) continue;
    seen.add(release.id);
    items.push({
      id: grant.id,
      downloadedAt: grant.createdAt.toISOString(),
      release: {
        id: release.id,
        title: release.title,
        communityId: release.communityId
      },
      artist: primaryArtist(release.credits)
    });
    if (items.length >= 5) break;
  }

  return items;
};

const getProfileCollages = async (
  userId: number
): Promise<{
  featuredPersonalCollages: ProfileCollagePreview[];
  publicCollages: ProfileCollagePreview[];
}> => {
  const select = {
    id: true,
    name: true,
    categoryId: true,
    isFeatured: true,
    numEntries: true,
    createdAt: true,
    updatedAt: true,
    entries: {
      orderBy: { sort: 'asc' as const },
      take: 4,
      select: {
        release: {
          select: {
            image: true
          }
        }
      }
    }
  };

  const [featuredPersonalCollages, publicCollages] = await Promise.all([
    prisma.collage.findMany({
      where: {
        userId,
        categoryId: 0,
        isDeleted: false,
        isFeatured: true
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 3,
      select
    }),
    prisma.collage.findMany({
      where: {
        userId,
        categoryId: { gt: 0 },
        isDeleted: false
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 6,
      select
    })
  ]);

  const mapCollage = (
    collage: (typeof featuredPersonalCollages)[number]
  ): ProfileCollagePreview => ({
    id: collage.id,
    name: collage.name,
    categoryId: collage.categoryId,
    isFeatured: collage.isFeatured,
    numEntries: collage.numEntries,
    createdAt: collage.createdAt.toISOString(),
    updatedAt: collage.updatedAt.toISOString(),
    coverImages: collage.entries
      .map((entry) => entry.release.image)
      .filter((image): image is string => !!image)
  });

  return {
    featuredPersonalCollages: featuredPersonalCollages.map(mapCollage),
    publicCollages: publicCollages.map(mapCollage)
  };
};

const buildDonorPresentation = (
  user: ProfileUserRecord
): DonorPresentation | null => {
  const donorRank = user.donorRank;
  const donorReward = user.donorReward;

  // Enforce expiry: treat an expired grant as absent so stale rewards never
  // render while the hourly sweep hasn't fired yet.
  const now = new Date();
  const activeRank =
    donorRank && (donorRank.expiresAt === null || donorRank.expiresAt > now)
      ? donorRank
      : null;

  const perks: PerksMap = activeRank
    ? parsePerks(activeRank.donorRank.perks)
    : {};

  // Profile blocks filtered by per-block perks
  const profileBlocks =
    donorReward && activeRank
      ? (
          [
            perks.profileInfo1
              ? {
                  title: donorReward.profileInfoTitle1,
                  body: donorReward.profileInfo1
                }
              : null,
            perks.profileInfo2
              ? {
                  title: donorReward.profileInfoTitle2,
                  body: donorReward.profileInfo2
                }
              : null,
            perks.profileInfo3
              ? {
                  title: donorReward.profileInfoTitle3,
                  body: donorReward.profileInfo3
                }
              : null,
            perks.profileInfo4
              ? {
                  title: donorReward.profileInfoTitle4,
                  body: donorReward.profileInfo4
                }
              : null
          ] as Array<{ title: string; body: string } | null>
        ).filter(
          (b): b is { title: string; body: string } =>
            b !== null && !!(b.title.trim() || b.body.trim())
        )
      : [];

  const presentation: DonorPresentation = {
    rank: activeRank
      ? {
          name: activeRank.donorRank.name,
          badge: activeRank.donorRank.badge,
          color: activeRank.donorRank.color,
          grantedAt: activeRank.grantedAt.toISOString(),
          expiresAt: activeRank.expiresAt?.toISOString() ?? null
        }
      : null,
    customIcon:
      donorReward && perks.customIcon ? donorReward.customIcon || null : null,
    customIconLink:
      donorReward && perks.customIconLink
        ? donorReward.customIconLink || null
        : null,
    secondAvatar:
      donorReward && perks.secondAvatar
        ? donorReward.secondAvatar || null
        : null,
    iconMouseOverText:
      donorReward && perks.iconMouseOverText
        ? donorReward.iconMouseOverText || null
        : null,
    avatarMouseOverText:
      donorReward && perks.avatarMouseOverText
        ? donorReward.avatarMouseOverText || null
        : null,
    profileBlocks
  };

  if (
    !presentation.rank &&
    !presentation.customIcon &&
    !presentation.customIconLink &&
    !presentation.secondAvatar &&
    !presentation.iconMouseOverText &&
    !presentation.avatarMouseOverText &&
    !presentation.profileBlocks.length
  ) {
    return null;
  }

  return presentation;
};

const buildPercentile = (
  totalUsers: number,
  aboveCount: number,
  raw: number | null
): ProfilePercentile => {
  const rank = aboveCount + 1;
  const percentile =
    totalUsers <= 1
      ? 100
      : Math.max(1, Math.round(((totalUsers - rank) / (totalUsers - 1)) * 100));

  return {
    percentile,
    rank,
    total: totalUsers,
    raw
  };
};

/**
 * Provisional weights for the Overall composite. They encode what the site wants
 * to reward: contributing the catalog outweighs consuming it, and forum/metadata
 * activity is a tiebreaker rather than a route to the top. A bounty-style
 * dimension has no analog until the deferred economy lands.
 */
const OVERALL_WEIGHTS = {
  contributed: 15,
  consumed: 8,
  contributions: 25,
  requestsFilled: 2,
  forumPosts: 1,
  artistsAdded: 1
} as const;

/**
 * Weighted mean of the dimension percentiles, scaled by `min(ratio, 1)` so a
 * member who consumes more than they contribute can't ride volume to the top.
 * Pure so the composite is testable without a DB.
 */
export const buildOverallPercentile = (
  dimensions: Record<keyof typeof OVERALL_WEIGHTS, { percentile: number }>,
  ratio: number
): number => {
  const totalWeight = Object.values(OVERALL_WEIGHTS).reduce((a, b) => a + b, 0);
  const weighted = (
    Object.keys(OVERALL_WEIGHTS) as Array<keyof typeof OVERALL_WEIGHTS>
  ).reduce(
    (sum, key) => sum + dimensions[key].percentile * OVERALL_WEIGHTS[key],
    0
  );

  return Math.round((weighted / totalWeight) * Math.min(ratio, 1));
};

export const getPercentileSummary = async (
  user: Pick<ProfileUserRecord, 'id' | 'contributed' | 'consumed'>,
  activitySummary: ProfileActivitySummary,
  visibility: { canSeeContributed: boolean; canSeeConsumed: boolean }
): Promise<ProfilePercentileSummary> => {
  const [
    totalRow,
    uploadedRows,
    downloadedRows,
    contributionsRows,
    forumRows,
    fillsRows,
    artistsAddedRow,
    artistsRows
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "users"
      WHERE "disabled" = false
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "users"
      WHERE "disabled" = false
        AND "contributed" > ${user.contributed}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "users"
      WHERE "disabled" = false
        AND "consumed" > ${user.consumed}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT u."id", COUNT(c."id")::bigint AS metric_count
        FROM "users" u
        LEFT JOIN "contributions" c ON c."userId" = u."id"
        WHERE u."disabled" = false
        GROUP BY u."id"
      ) ranked
      WHERE ranked.metric_count > ${activitySummary.contributions}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT u."id", COUNT(fp."id")::bigint AS metric_count
        FROM "users" u
        LEFT JOIN "forum_posts" fp
          ON fp."authorId" = u."id" AND fp."deletedAt" IS NULL
        WHERE u."disabled" = false
        GROUP BY u."id"
      ) ranked
      WHERE ranked.metric_count > ${activitySummary.forumPosts}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT u."id", COUNT(rf."id")::bigint AS metric_count
        FROM "users" u
        LEFT JOIN "request_fills" rf ON rf."fillerId" = u."id"
        WHERE u."disabled" = false
        GROUP BY u."id"
      ) ranked
      WHERE ranked.metric_count > ${activitySummary.requestsFilled}
    `,
    // An artist has no creator column; the author of its earliest history row is
    // the member who added it (see createArtist in modules/artist.ts).
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT DISTINCT ON (h."artistId") h."artistId", h."editedBy"
        FROM "artist_histories" h
        ORDER BY h."artistId", h."id" ASC
      ) creators
      WHERE creators."editedBy" = ${user.id}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT u."id", COUNT(creators."artistId")::bigint AS metric_count
        FROM "users" u
        LEFT JOIN (
          SELECT DISTINCT ON (h."artistId") h."artistId", h."editedBy"
          FROM "artist_histories" h
          ORDER BY h."artistId", h."id" ASC
        ) creators ON creators."editedBy" = u."id"
        WHERE u."disabled" = false
        GROUP BY u."id"
      ) ranked
      WHERE ranked.metric_count > (
        SELECT COUNT(*)::bigint
        FROM (
          SELECT DISTINCT ON (h."artistId") h."artistId", h."editedBy"
          FROM "artist_histories" h
          ORDER BY h."artistId", h."id" ASC
        ) mine
        WHERE mine."editedBy" = ${user.id}
      )
    `
  ]);

  const totalUsers = Number(totalRow[0]?.count ?? BigInt(0));
  const artistsAddedCount = Number(artistsAddedRow[0]?.count ?? BigInt(0));

  const dimensions = {
    contributed: buildPercentile(
      totalUsers,
      Number(uploadedRows[0]?.count ?? BigInt(0)),
      visibility.canSeeContributed ? Number(user.contributed) : null
    ),
    consumed: buildPercentile(
      totalUsers,
      Number(downloadedRows[0]?.count ?? BigInt(0)),
      visibility.canSeeConsumed ? Number(user.consumed) : null
    ),
    contributions: buildPercentile(
      totalUsers,
      Number(contributionsRows[0]?.count ?? BigInt(0)),
      activitySummary.contributions
    ),
    forumPosts: buildPercentile(
      totalUsers,
      Number(forumRows[0]?.count ?? BigInt(0)),
      activitySummary.forumPosts
    ),
    requestsFilled: buildPercentile(
      totalUsers,
      Number(fillsRows[0]?.count ?? BigInt(0)),
      activitySummary.requestsFilled
    ),
    artistsAdded: buildPercentile(
      totalUsers,
      Number(artistsRows[0]?.count ?? BigInt(0)),
      artistsAddedCount
    )
  };

  return {
    ...dimensions,
    overall: buildOverallPercentile(
      dimensions,
      computeRatio(user.contributed, user.consumed)
    )
  };
};

const getStaffPmOverview = async (
  userId: number
): Promise<ProfileStaffPmOverview> => {
  const [total, unresolved, conversations] = await Promise.all([
    prisma.staffInboxConversation.count({ where: { userId } }),
    prisma.staffInboxConversation.count({
      where: { userId, status: { not: 'Resolved' } }
    }),
    prisma.staffInboxConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        subject: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        assignedUser: { select: { id: true, username: true } },
        _count: { select: { messages: true } }
      }
    })
  ]);

  return {
    total,
    unresolved,
    recentConversations: conversations.map((conversation) => ({
      id: conversation.id,
      subject: conversation.subject,
      status: conversation.status,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      assignedStaff: conversation.assignedUser,
      replyCount: Math.max(0, conversation._count.messages - 1),
      viewerCanOpen: true
    }))
  };
};

/** A member's invite-tree summary, as far as the community block needs it. */
interface InviteSummaryView {
  summary: { branches: number; entries: number; depth: number };
}

/**
 * Shape the PRD-01 Profile Integration community-stats block from already-fetched
 * inputs. Pure so the paranoia gating is testable without a DB:
 *  - any input `null` (the caller didn't fetch it because the top paranoia tier
 *    hides every stat) → the whole block is `null`.
 *  - `includeSnatchDerived` false (consumed stats hidden, paranoia ≥ 2) → the
 *    snatch-derived (`ratio`) dimension drops out of the reputation view and its
 *    score is recomputed (see `filterReputationView`).
 */
export const buildCommunityStats = (
  friendCount: number | null,
  inviteView: InviteSummaryView | null,
  reputation: CrsResult | null,
  includeSnatchDerived: boolean,
  includeModeration: boolean
): {
  friends: number;
  invites: { direct: number; total: number; depth: number };
  reputation: CrsResult;
} | null => {
  if (friendCount === null || inviteView === null || reputation === null) {
    return null;
  }
  return {
    friends: friendCount,
    invites: {
      direct: inviteView.summary.branches,
      total: inviteView.summary.entries,
      depth: inviteView.summary.depth
    },
    reputation: filterReputationView(reputation, {
      includeSnatchDerived,
      includeModeration
    })
  };
};

const buildProfileView = async (
  user: ProfileUserRecord,
  viewer: ViewerContext,
  includeInviteTree: boolean
) => {
  const settings = user.userSettings as UserSettingsView;
  const rawProfile = user.profile ?? {
    id: user.profileId,
    avatar: null,
    avatarMouseoverText: null,
    profileTitle: null,
    profileInfo: null
  };
  // Additive render-at-read: keep raw `profileInfo` (the editor round-trips the
  // source) and attach the transcribed, sanitized `profileInfoHtml` (#398/#402).
  const profile = {
    ...rawProfile,
    profileInfoHtml: await renderSiteBBCode(rawProfile.profileInfo)
  };
  const canSeeEmail = viewer.isOwner || viewer.isStaff || settings.showEmail;
  const canSeeLastSeen =
    viewer.isOwner || viewer.isStaff || settings.showLastSeen;
  const canSeeUploaded =
    viewer.isOwner || viewer.isStaff || settings.showContributedStats;
  const canSeeDownloaded =
    viewer.isOwner || viewer.isStaff || settings.showConsumedStats;
  const canSeeRatio =
    viewer.isOwner || viewer.isStaff || settings.showRatioStats;
  const canSeeSnatches = viewer.isOwner || viewer.isStaff;

  // PRD-01 Profile Integration: the community-stats block (friends count, invite
  // summary, reputation) is visible unless the highest paranoia tier hides every
  // stat — same gate as ratio/buffer (`canSeeRatio`). Compute it only when
  // visible so non-visible profile loads don't pay for the extra queries.
  const [
    activitySummary,
    recentContributions,
    recentSnatches,
    inviteRows,
    collageShelves,
    staffPmOverview,
    friendCount,
    inviteView,
    reputation
  ] = await Promise.all([
    getActivitySummary(user.id),
    getRecentContributions(user.id),
    canSeeSnatches ? getRecentSnatches(user.id) : Promise.resolve([]),
    includeInviteTree
      ? getInviteSubtreeRows(user.id)
      : Promise.resolve([] as InviteSubtreeRow[]),
    getProfileCollages(user.id),
    viewer.isStaff ? getStaffPmOverview(user.id) : Promise.resolve(null),
    canSeeRatio
      ? prisma.friendRelationship.count({
          where: {
            status: 'accepted',
            OR: [{ requesterId: user.id }, { recipientId: user.id }]
          }
        })
      : Promise.resolve(null),
    canSeeRatio
      ? getMemberInviteTreeView(user.id, viewer.isStaff)
      : Promise.resolve(null),
    canSeeRatio ? getReputation(user.id) : Promise.resolve(null)
  ]);

  const community = buildCommunityStats(
    friendCount,
    inviteView,
    reputation,
    canSeeDownloaded,
    viewer.isStaff // contagion drag + suspect flag are staff-only (ADR-0004 §3)
  );
  const percentiles = await getPercentileSummary(user, activitySummary, {
    canSeeContributed: canSeeUploaded,
    canSeeConsumed: canSeeDownloaded
  });
  const donorPresentation = buildDonorPresentation(user);
  const derivedRatio = computeRatio(user.contributed, user.consumed);

  // PRD-05 #2 / ADR-0004 — governance standing rolled from warnings + ban state.
  const now = new Date();
  const standing = computeStanding({
    warnings: user.warnings,
    banned: user.banDate !== null,
    now,
    accountAgeDays: Math.floor(
      (now.getTime() - user.dateRegistered.getTime()) / DAY_MS
    )
  });

  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    email: canSeeEmail ? user.email : null,
    dateRegistered: user.dateRegistered.toISOString(),
    lastSeen:
      canSeeLastSeen && user.lastLogin ? user.lastLogin.toISOString() : null,
    isArtist: user.isArtist,
    isDonor: user.isDonor,
    disabled: user.disabled,
    warned: user.warned?.toISOString() ?? null,
    standing,
    inviteCount: viewer.isOwner || viewer.isStaff ? user.inviteCount : null,
    staffBio: user.staffBio ?? null,
    stats: {
      contributed: canSeeUploaded ? user.contributed.toString() : null,
      consumed: canSeeDownloaded ? user.consumed.toString() : null,
      ratio: canSeeRatio ? derivedRatio.toFixed(2) : null,
      buffer:
        canSeeUploaded || canSeeDownloaded
          ? (user.contributed - user.consumed).toString()
          : null
    },
    userRank: user.userRank
      ? {
          id: user.userRank.id,
          name: user.userRank.name,
          color: user.userRank.color,
          badge: user.userRank.badge,
          displayStaff: user.userRank.displayStaff
        }
      : {
          id: 0,
          name: '',
          color: '',
          badge: '',
          displayStaff: false
        },
    profile,
    userSettings: viewer.isOwner
      ? {
          id: settings.id,
          siteAppearance: settings.siteAppearance,
          externalStylesheet: settings.externalStylesheet,
          activeAuthorStylesheetId: settings.activeAuthorStylesheetId,
          styledTooltips: settings.styledTooltips,
          paranoia: settings.paranoia,
          notificationMethod: settings.notificationMethod,
          showEmail: settings.showEmail,
          showLastSeen: settings.showLastSeen,
          showContributedStats: settings.showContributedStats,
          showConsumedStats: settings.showConsumedStats,
          showRatioStats: settings.showRatioStats
        }
      : undefined,
    activitySummary,
    percentiles,
    donorPresentation,
    collageShelves,
    staffPmOverview,
    recentContributions,
    recentSnatches,
    inviteTree:
      includeInviteTree && inviteRows.length
        ? buildInviteTree(inviteRows, user.id, viewer.isOwner || viewer.isStaff)
        : [],
    community
  };
};

export const getProfileById = async (
  targetUserId: number,
  viewerUserId?: number
) => {
  const viewer = await loadViewerContext(targetUserId, viewerUserId);
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: PROFILE_BASE_SELECT
  });
  if (!user) return null;
  return buildProfileView(user, viewer, viewer.isOwner || viewer.isStaff);
};

export const getProfileByLookup = async (
  userIdOrUsername: string,
  viewerUserId?: number
) => {
  const trimmedLookup = userIdOrUsername.trim();
  const numericId = Number(trimmedLookup);
  const isNumeric =
    !Number.isNaN(numericId) && Number.isInteger(numericId) && numericId > 0;

  let user = isNumeric
    ? await prisma.user.findUnique({
        where: { id: numericId },
        select: PROFILE_BASE_SELECT
      })
    : await prisma.user.findFirst({
        where: {
          username: { equals: trimmedLookup, mode: 'insensitive' }
        },
        select: PROFILE_BASE_SELECT
      });

  if (!user && isNumeric) {
    user = await prisma.user.findFirst({
      where: {
        username: { equals: trimmedLookup, mode: 'insensitive' }
      },
      select: PROFILE_BASE_SELECT
    });
  }

  if (!user) return null;
  const viewer = await loadViewerContext(user.id, viewerUserId);
  return buildProfileView(user, viewer, viewer.isOwner || viewer.isStaff);
};

// Paranoia is the single privacy control. Each level hides progressively more:
//   0 = fully visible; 1 = hide email + last-seen; 2 = also hide contributed/
//   consumed stats; 3 = also hide ratio/buffer.
const paranoiaToVisibility = (level: number) => ({
  showEmail: level < 1,
  showLastSeen: level < 1,
  showContributedStats: level < 2,
  showConsumedStats: level < 2,
  showRatioStats: level < 3
});

export const updateProfile = async (
  userId: number,
  data: {
    avatar?: string;
    avatarMouseoverText?: string;
    profileTitle?: string;
    profileInfo?: string;
    siteAppearance?: string;
    externalStylesheet?: string;
    activeAuthorStylesheetId?: number | null;
    styledTooltips?: boolean;
    paranoia?: number;
    notificationMethod?: NotificationMethod;
    showEmail?: boolean;
    showLastSeen?: boolean;
    showContributedStats?: boolean;
    showConsumedStats?: boolean;
    showRatioStats?: boolean;
  }
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { profileId: true, userSettingsId: true }
  });
  if (!user) return null;

  // Site Stylesheet radio (ADR-0024 §4): Personal (external URL) and Registry
  // (author-sheet pointer) are two arms of one slot. Selecting one clears the
  // other, and both-at-once is a contract violation a radio UI can't produce but
  // a raw API client could — so reject it rather than pick a silent winner.
  const settingExternal =
    data.externalStylesheet !== undefined && data.externalStylesheet !== '';
  const settingPointer =
    data.activeAuthorStylesheetId !== undefined &&
    data.activeAuthorStylesheetId !== null;
  if (settingExternal && settingPointer) {
    throw new AppError(
      400,
      'Choose one Site Stylesheet source — an external URL or a registry stylesheet, not both.'
    );
  }
  if (settingPointer) {
    // FK would reject a bad id as a raw P2003 → 500; surface it as a clean 400.
    const exists = await prisma.authorStylesheet.findUnique({
      where: { id: data.activeAuthorStylesheetId! },
      select: { id: true }
    });
    if (!exists) throw new AppError(400, 'Author stylesheet not found');
  }
  const stylesheetSlot: {
    externalStylesheet?: string | null;
    activeAuthorStylesheetId?: number | null;
  } = {};
  if (data.externalStylesheet !== undefined) {
    stylesheetSlot.externalStylesheet = data.externalStylesheet || null;
    if (settingExternal) stylesheetSlot.activeAuthorStylesheetId = null;
  }
  if (data.activeAuthorStylesheetId !== undefined) {
    stylesheetSlot.activeAuthorStylesheetId = data.activeAuthorStylesheetId;
    if (settingPointer) stylesheetSlot.externalStylesheet = null;
  }

  await prisma.$transaction([
    prisma.profile.update({
      where: { id: user.profileId },
      data: {
        ...(data.avatar !== undefined && {
          avatar: data.avatar ? sanitizePlain(data.avatar) : null
        }),
        ...(data.avatarMouseoverText !== undefined && {
          avatarMouseoverText: data.avatarMouseoverText
            ? sanitizePlain(data.avatarMouseoverText)
            : null
        }),
        ...(data.profileTitle !== undefined && {
          profileTitle: data.profileTitle
            ? sanitizePlain(data.profileTitle)
            : null
        }),
        ...(data.profileInfo !== undefined && {
          // Store raw BBCode; transcription + sanitization happen at read time
          // via renderBBCode (#398/#402).
          profileInfo: data.profileInfo || null
        })
      }
    }),
    prisma.userSettings.update({
      where: { id: user.userSettingsId },
      data: {
        ...(data.siteAppearance !== undefined && {
          siteAppearance: data.siteAppearance
        }),
        ...stylesheetSlot,
        ...(data.styledTooltips !== undefined && {
          styledTooltips: data.styledTooltips
        }),
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
        }),
        ...(data.paranoia !== undefined && {
          paranoia: data.paranoia,
          ...paranoiaToVisibility(data.paranoia)
        })
      }
    })
  ]);

  return getProfileById(userId, userId);
};

type CreateInviteResult =
  | { ok: true; inviteKey: string; emailSent: boolean }
  | { ok: false; reason: 'no_invites' | 'already_invited' };

export const createInvite = async (
  inviterId: number,
  email: string,
  reason: string
): Promise<CreateInviteResult> => {
  const normalizedEmail = sanitizePlain(email).trim().toLowerCase();
  const normalizedReason = sanitizePlain(reason).trim();

  const inviter = await prisma.user.findUnique({
    where: { id: inviterId },
    select: { inviteCount: true }
  });
  if (!inviter || inviter.inviteCount <= 0) {
    return { ok: false, reason: 'no_invites' };
  }

  const existing = await prisma.invite.findFirst({
    where: { email: normalizedEmail }
  });
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
        email: normalizedEmail,
        expires,
        reason: normalizedReason
      }
    }),
    prisma.user.update({
      where: { id: inviterId },
      data: { inviteCount: { decrement: 1 } }
    })
  ]);

  let emailSent = false;
  try {
    emailSent = await sendInviteEmail(normalizedEmail, inviteKey);
  } catch (err) {
    log.error('Failed to send invite email', { to: normalizedEmail, err });
  }

  return { ok: true, inviteKey, emailSent };
};
