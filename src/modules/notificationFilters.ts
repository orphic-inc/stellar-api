import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { getLogger } from './logging';
import { runInBackground } from './backgroundTasks';
import { contributionVisibleTo, releaseVisibleTo } from './communityAccess';
import { resolveTagNames } from './tag';
import {
  filterMatches,
  hasCriterion,
  isFirstMatchOnRelease,
  type ContributionFacts
} from './notificationFilterMatch';
import type { NotificationFilterInput } from '../schemas/notificationFilters';

/**
 * Contribution notification filters (#263, ADR-0049): a member's saved watches
 * over new contributions, and the hits they collect.
 *
 * The predicate is `notificationFilterMatch.ts`, pure. This file owns the
 * database around it: the rank allowance, the post-commit matcher, and the hit
 * reads, every one of which re-applies `releaseVisibleTo` — a member who loses
 * access to a community stops seeing its hits, as the Member Feed does.
 *
 * NO NEW `NotificationType`. Hits are their own satellite with their own count;
 * writing them into `Notification` as well would make a per-filter catch-up
 * disagree with the notification's own read state.
 */

const log = getLogger('notificationFilters');

const filterSelect = {
  id: true,
  label: true,
  artistIds: true,
  tags: true,
  notTags: true,
  communityIds: true,
  releaseTypes: true,
  releaseCategories: true,
  fileTypes: true,
  bitrates: true,
  media: true,
  fromYear: true,
  toYear: true,
  newReleasesOnly: true,
  excludeCompilations: true,
  mainCreditsOnly: true,
  createdAt: true,
  updatedAt: true
} as const satisfies Prisma.NotificationFilterSelect;

const dedupe = <T>(values: T[]): T[] => [...new Set(values)];

// ─── The allowance ────────────────────────────────────────────────────────────

/**
 * The rank's `notificationFilterLimit`, refusing a rank that has none.
 *
 * `0` is the only gate on the feature — there is no permission key beside it —
 * so it answers 403 on every filter route, not only on create. `null` is
 * unlimited, and must not be collapsed to `0` on the way out: a missing rank
 * fails closed, an uncapped one does not.
 */
export const getFilterAllowance = async (
  userRankId: number
): Promise<number | null> => {
  const rank = await prisma.userRank.findUnique({
    where: { id: userRankId },
    select: { notificationFilterLimit: true }
  });
  const limit = rank ? rank.notificationFilterLimit : 0;
  if (limit === 0) {
    throw new AppError(403, 'Your rank cannot use notification filters');
  }
  return limit;
};

// ─── Filters ──────────────────────────────────────────────────────────────────

/**
 * Add `artists: { id, name }[]` beside `artistIds` (#715), so a list of filters
 * costs one artist read rather than one per chip. Display only: `artistIds`
 * stays the value a client writes back. A withdrawn artist keeps its id there
 * but gets no entry here, which is how a client tells it has gone.
 */
const withArtistNames = async <F extends { artistIds: number[] }>(
  filters: F[]
): Promise<(F & { artists: { id: number; name: string }[] })[]> => {
  const ids = dedupe(filters.flatMap((f) => f.artistIds));
  const names = new Map<number, string>();
  if (ids.length > 0) {
    const artists = await prisma.artist.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, name: true }
    });
    for (const { id, name } of artists) names.set(id, name);
  }
  return filters.map((f) => ({
    ...f,
    artists: f.artistIds.flatMap((id) => {
      const name = names.get(id);
      return name === undefined ? [] : [{ id, name }];
    })
  }));
};

export const listNotificationFilters = async (userId: number) =>
  withArtistNames(
    await prisma.notificationFilter.findMany({
      where: { userId },
      orderBy: [{ id: 'asc' }],
      select: filterSelect
    })
  );

/**
 * Validated input → the row's criteria. Tags go through the tag name rule and
 * aliases (#689), so a filter holds the names releases carry. Artists must exist
 * and be live: a filter watching a withdrawn artist would never fire.
 */
const prepareCriteria = async (input: NotificationFilterInput) => {
  const artistIds = dedupe(input.artistIds);
  if (artistIds.length > 0) {
    const live = await prisma.artist.count({
      where: { id: { in: artistIds }, deletedAt: null }
    });
    if (live !== artistIds.length) {
      throw new AppError(400, 'An artist in this filter does not exist');
    }
  }
  const criteria = {
    label: input.label,
    artistIds,
    tags: await resolveTagNames(input.tags),
    notTags: await resolveTagNames(input.notTags),
    communityIds: dedupe(input.communityIds),
    releaseTypes: dedupe(input.releaseTypes),
    releaseCategories: dedupe(input.releaseCategories),
    fileTypes: dedupe(input.fileTypes),
    bitrates: dedupe(input.bitrates),
    media: dedupe(input.media),
    fromYear: input.fromYear,
    toYear: input.toYear,
    newReleasesOnly: input.newReleasesOnly,
    excludeCompilations: input.excludeCompilations,
    mainCreditsOnly: input.mainCreditsOnly
  };
  // Checked AFTER normalizing: tags that normalize away leave nothing behind.
  if (!hasCriterion(criteria)) {
    throw new AppError(400, 'A filter needs at least one criterion');
  }
  return criteria;
};

export const createNotificationFilter = async (
  userId: number,
  limit: number | null,
  input: NotificationFilterInput
) => {
  if (limit !== null) {
    const owned = await prisma.notificationFilter.count({ where: { userId } });
    if (owned >= limit) {
      throw new AppError(400, `Notification filter limit reached (${limit}).`);
    }
  }
  const data = await prepareCriteria(input);
  const created = await prisma.notificationFilter.create({
    data: { ...data, userId },
    select: filterSelect
  });
  const [named] = await withArtistNames([created]);
  return named;
};

/** Load a filter the member owns, or the one 404 a stranger's id also gets. */
const assertOwnFilter = async (userId: number, id: number) => {
  const owned = await prisma.notificationFilter.count({
    where: { id, userId }
  });
  if (owned === 0) throw new AppError(404, 'Notification filter not found');
};

export const updateNotificationFilter = async (
  userId: number,
  id: number,
  input: NotificationFilterInput
) => {
  await assertOwnFilter(userId, id);
  const data = await prepareCriteria(input);
  // `updateMany` keyed on the owner too, so a filter deleted between the check
  // and the write is a 404 rather than a P2025 500.
  const { count } = await prisma.notificationFilter.updateMany({
    where: { id, userId },
    data
  });
  if (count === 0) throw new AppError(404, 'Notification filter not found');
  const updated = await prisma.notificationFilter.findUniqueOrThrow({
    where: { id },
    select: filterSelect
  });
  const [named] = await withArtistNames([updated]);
  return named;
};

export const deleteNotificationFilter = async (userId: number, id: number) => {
  const { count } = await prisma.notificationFilter.deleteMany({
    where: { id, userId }
  });
  if (count === 0) throw new AppError(404, 'Notification filter not found');
};

// ─── Matching ─────────────────────────────────────────────────────────────────

const OPEN_RANK: Prisma.UserRankWhereInput = {
  OR: [
    { notificationFilterLimit: null },
    { notificationFilterLimit: { gt: 0 } }
  ]
};

const loadFacts = (contributionId: number) =>
  prisma.contribution.findUnique({
    where: { id: contributionId },
    select: {
      id: true,
      userId: true,
      releaseId: true,
      type: true,
      releaseFile: { select: { bitrate: true } },
      edition: { select: { year: true, media: true } },
      release: {
        select: {
          communityId: true,
          type: true,
          releaseType: true,
          year: true,
          releaseTags: { select: { tag: { select: { name: true } } } },
          credits: { select: { artistId: true, role: true } }
        }
      }
    }
  });

/** Of these members, the ones who can see the release. */
const membersWhoCanSee = async (
  releaseId: number,
  userIds: number[]
): Promise<Set<number>> => {
  const verdicts = await Promise.all(
    userIds.map(async (userId) => {
      const visible = await prisma.release.count({
        where: { AND: [{ id: releaseId }, releaseVisibleTo(userId)] }
      });
      return [userId, visible > 0] as const;
    })
  );
  return new Set(verdicts.filter(([, v]) => v).map(([userId]) => userId));
};

/**
 * Record a hit for every filter that wants this contribution. Returns how many.
 *
 * O(matching filters), not O(members × filters): Postgres array operators narrow
 * to the filters whose artist, tag and community lists are empty or overlap
 * this contribution's, and only those reach the predicate. The uploader,
 * disabled accounts and ranks without the allowance are excluded in the same
 * query; access is applied last, per surviving member.
 */
export const matchFiltersForContribution = async (
  contributionId: number
): Promise<number> => {
  const c = await loadFacts(contributionId);
  if (!c) return 0;

  const facts: ContributionFacts = {
    communityId: c.release.communityId,
    releaseType: c.release.type,
    releaseCategory: c.release.releaseType,
    fileType: c.type,
    bitrate: c.releaseFile?.bitrate ?? null,
    media: c.edition.media,
    releaseYear: c.release.year,
    editionYear: c.edition.year,
    tags: c.release.releaseTags.map((rt) => rt.tag.name),
    credits: c.release.credits
  };
  const creditArtistIds = dedupe(facts.credits.map((cr) => cr.artistId));

  const candidates = await prisma.notificationFilter.findMany({
    where: {
      userId: { not: c.userId },
      user: { disabled: false, userRank: OPEN_RANK },
      AND: [
        {
          OR: [
            { artistIds: { isEmpty: true } },
            { artistIds: { hasSome: creditArtistIds } }
          ]
        },
        {
          OR: [{ tags: { isEmpty: true } }, { tags: { hasSome: facts.tags } }]
        },
        {
          OR: [
            { communityIds: { isEmpty: true } },
            ...(facts.communityId !== null
              ? [{ communityIds: { has: facts.communityId } }]
              : [])
          ]
        }
      ]
    },
    select: { ...filterSelect, userId: true }
  });

  let matched = candidates.filter((f) => filterMatches(f, facts));

  if (matched.some((f) => f.newReleasesOnly)) {
    const earlier = await prisma.contribution.findMany({
      where: { releaseId: c.releaseId, id: { lt: c.id } },
      select: { type: true, releaseFile: { select: { bitrate: true } } }
    });
    const formats = earlier.map((e) => ({
      fileType: e.type,
      bitrate: e.releaseFile?.bitrate ?? null
    }));
    matched = matched.filter(
      (f) => !f.newReleasesOnly || isFirstMatchOnRelease(f, formats)
    );
  }
  if (matched.length === 0) return 0;

  const allowed = await membersWhoCanSee(
    c.releaseId,
    dedupe(matched.map((f) => f.userId))
  );
  const rows = matched
    .filter((f) => allowed.has(f.userId))
    .map((f) => ({ filterId: f.id, userId: f.userId, contributionId: c.id }));
  if (rows.length === 0) return 0;

  const { count } = await prisma.notificationFilterHit.createMany({
    data: rows,
    skipDuplicates: true
  });
  return count;
};

/**
 * Match after the contribution has committed, without holding up the upload.
 * A matching failure is logged and never rolls back or fails a contribution —
 * worst case, hits arrive late or not at all.
 */
export const scheduleFilterMatching = (contributionId: number): void => {
  runInBackground(
    matchFiltersForContribution(contributionId).catch((err) =>
      log.warn('Notification filter matching failed', { contributionId, err })
    )
  );
};

// ─── Hits ─────────────────────────────────────────────────────────────────────

/**
 * The hit rows in scope: one filter's, or every filter's. A contribution three
 * filters caught is three rows; everything member-facing below counts and lists
 * CONTRIBUTIONS, so it is one unread and one item.
 */
const hitScope = (userId: number, filterId?: number) => ({
  userId,
  ...(filterId !== undefined && { filterId })
});

export const listNotificationFilterHits = async (
  userId: number,
  opts: { filterId?: number; unread?: boolean; skip: number; take: number }
) => {
  if (opts.filterId !== undefined) await assertOwnFilter(userId, opts.filterId);
  const scope = hitScope(userId, opts.filterId);
  const where: Prisma.ContributionWhereInput = {
    ...contributionVisibleTo(userId),
    notificationFilterHits: {
      some: { ...scope, ...(opts.unread && { readAt: null }) }
    }
  };
  const [contributions, total] = await Promise.all([
    prisma.contribution.findMany({
      where,
      orderBy: [{ id: 'desc' }],
      skip: opts.skip,
      take: opts.take,
      select: {
        id: true,
        type: true,
        createdAt: true,
        releaseFile: { select: { bitrate: true } },
        user: { select: { id: true, username: true } },
        release: {
          select: { id: true, title: true, year: true, communityId: true }
        },
        notificationFilterHits: {
          where: scope,
          orderBy: [{ filterId: 'asc' }, { id: 'asc' }],
          select: {
            readAt: true,
            createdAt: true,
            filter: { select: { id: true, label: true } }
          }
        }
      }
    }),
    prisma.contribution.count({ where })
  ]);

  const items = contributions.map(({ notificationFilterHits: hits, ...c }) => ({
    contributionId: c.id,
    // Read only when every row in scope is: in the combined view, one filter
    // still holding it unread keeps the item unread.
    read: hits.every((h) => h.readAt !== null),
    matchedAt: hits.reduce(
      (min, h) => (h.createdAt < min ? h.createdAt : min),
      hits[0]?.createdAt ?? c.createdAt
    ),
    filters: hits.map((h) => h.filter),
    contribution: {
      id: c.id,
      type: c.type,
      bitrate: c.releaseFile?.bitrate ?? null,
      createdAt: c.createdAt,
      uploader: c.user,
      release: c.release
    }
  }));
  return { items, total };
};

/** Contributions with an unread hit, not unread rows. */
export const countUnreadNotificationFilterHits = (userId: number) =>
  prisma.contribution.count({
    where: {
      ...contributionVisibleTo(userId),
      notificationFilterHits: { some: { userId, readAt: null } }
    }
  });

/**
 * Mark a contribution's hits read — every filter's, or one filter's. A member
 * with no hit for it gets a 404; one whose hits were already read does not.
 */
export const markNotificationFilterHitRead = async (
  userId: number,
  contributionId: number,
  filterId?: number
) => {
  const where = { ...hitScope(userId, filterId), contributionId };
  const held = await prisma.notificationFilterHit.count({ where });
  if (held === 0) throw new AppError(404, 'Notification filter hit not found');
  await prisma.notificationFilterHit.updateMany({
    where: { ...where, readAt: null },
    data: { readAt: new Date() }
  });
};

/** Mark every hit read, or one filter's. */
export const catchUpNotificationFilterHits = async (
  userId: number,
  filterId?: number
) => {
  if (filterId !== undefined) await assertOwnFilter(userId, filterId);
  await prisma.notificationFilterHit.updateMany({
    where: { ...hitScope(userId, filterId), readAt: null },
    data: { readAt: new Date() }
  });
};

/**
 * Remove a contribution's hits, read or not — every filter's, or one filter's.
 * The single-item delete; the bulk clear below spares unread hits.
 */
export const deleteNotificationFilterHit = async (
  userId: number,
  contributionId: number,
  filterId?: number
) => {
  const { count } = await prisma.notificationFilterHit.deleteMany({
    where: { ...hitScope(userId, filterId), contributionId }
  });
  if (count === 0) throw new AppError(404, 'Notification filter hit not found');
};

/**
 * The legacy "clear all old": removes READ hits only, so one click cannot wipe
 * matches the member has not seen yet.
 */
export const clearReadNotificationFilterHits = async (
  userId: number,
  filterId?: number
) => {
  if (filterId !== undefined) await assertOwnFilter(userId, filterId);
  await prisma.notificationFilterHit.deleteMany({
    where: { ...hitScope(userId, filterId), readAt: { not: null } }
  });
};
