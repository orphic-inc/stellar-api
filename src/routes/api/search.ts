import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { releaseVisibleToViewer } from '../../modules/communityAccess';
import { forumReadableWhere } from '../../modules/forumAccess';
import { computeRatio } from '../../modules/ratio';
import { validateQuery, parsedQuery } from '../../middleware/validate';
import { parsedPage, paginatedResponse } from '../../lib/pagination';
import {
  releaseCreditsSelect,
  withPrimaryArtist
} from '../../modules/releaseCredits';
import {
  searchReleasesQuerySchema,
  searchArtistsQuerySchema,
  searchRequestsQuerySchema,
  searchLogQuerySchema,
  searchUsersQuerySchema,
  type SearchReleasesQuery,
  type SearchArtistsQuery,
  type SearchRequestsQuery,
  type SearchLogQuery,
  type SearchUsersQuery
} from '../../schemas/search';
import type { AuthenticatedRequest } from '../../types/auth';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildTagWhere(
  tags: string | undefined,
  tagMode: 'any' | 'all'
): object | undefined {
  const names = tags
    ?.split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (!names?.length) return undefined;
  return tagMode === 'all'
    ? {
        AND: names.map((name) => ({
          releaseTags: { some: { tag: { name } } }
        }))
      }
    : { releaseTags: { some: { tag: { name: { in: names } } } } };
}

function buildArtistTagWhere(
  tags: string | undefined,
  tagMode: 'any' | 'all'
): object | undefined {
  const names = tags
    ?.split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (!names?.length) return undefined;
  return tagMode === 'all'
    ? { AND: names.map((name) => ({ tags: { some: { tag: { name } } } })) }
    : { tags: { some: { tag: { name: { in: names } } } } };
}

/**
 * Contribution-level filters. `type` (file format) stays on the Contribution
 * spine; the music-rip specifics (bitrate, log/cue/scene) are edition-agnostic
 * per-file metadata living on the ReleaseFile satellite, so they nest under
 * `releaseFile`. bitrate is a typed enum now, so match exactly rather than
 * substring.
 */
function buildContributionFilter(
  q: SearchReleasesQuery
): Record<string, unknown> | undefined {
  const releaseFile: Record<string, unknown> = {};
  if (q.bitrate) releaseFile.bitrate = q.bitrate;
  if (q.hasLog !== undefined) releaseFile.hasLog = q.hasLog;
  if (q.hasCue !== undefined) releaseFile.hasCue = q.hasCue;
  if (q.isScene !== undefined) releaseFile.isScene = q.isScene;

  const filter: Record<string, unknown> = {};
  if (q.format) filter.type = q.format;
  if (Object.keys(releaseFile).length) filter.releaseFile = releaseFile;
  return Object.keys(filter).length ? filter : undefined;
}

/** Edition-level filters — label, catalogue and media are edition-scoped. */
function buildEditionFilter(
  q: SearchReleasesQuery
): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {};
  if (q.recordLabel)
    filter.recordLabel = { contains: q.recordLabel, mode: 'insensitive' };
  if (q.catalogueNumber)
    filter.catalogueNumber = {
      contains: q.catalogueNumber,
      mode: 'insensitive'
    };
  if (q.media) filter.media = q.media;
  return Object.keys(filter).length ? filter : undefined;
}

/** Artist-credit filters (name + vanityHouse), traversing the credits relation. */
function buildReleaseArtistFilter(
  q: SearchReleasesQuery
): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {};
  if (q.artist) filter.name = { contains: q.artist, mode: 'insensitive' };
  if (q.vanityHouse !== undefined) filter.vanityHouse = q.vanityHouse;
  return Object.keys(filter).length ? filter : undefined;
}

/**
 * Free-text and per-column text matching. `q` spans title, description and
 * credited artist name; the named params match their own column only.
 */
function buildReleaseTextWhere(
  q: SearchReleasesQuery
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (q.q) {
    where.OR = [
      { title: { contains: q.q, mode: 'insensitive' } },
      { description: { contains: q.q, mode: 'insensitive' } },
      {
        credits: {
          some: { artist: { name: { contains: q.q, mode: 'insensitive' } } }
        }
      }
    ];
  }
  if (q.title) where.title = { contains: q.title, mode: 'insensitive' };
  if (q.description)
    where.description = { contains: q.description, mode: 'insensitive' };
  return where;
}

/**
 * Scalar column matching, including the year range.
 *
 * `year` alone is a lower bound, `year`+`yearTo` a closed range, and `yearTo`
 * alone an upper bound — three shapes on one column, which is why this is
 * spelled out rather than folded into a generic equality pass.
 */
function buildReleaseScalarWhere(
  q: SearchReleasesQuery
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (q.type) where.type = q.type;
  if (q.releaseType) where.releaseType = q.releaseType;
  if (q.year)
    where.year = { gte: q.year, ...(q.yearTo ? { lte: q.yearTo } : {}) };
  if (q.yearTo && !q.year) where.year = { lte: q.yearTo };
  return where;
}

/**
 * The whole release `where`, assembled from the per-spine builders above.
 *
 * Extracted from the route handler rather than inlined: the handler was over
 * both of Codacy's Lizard thresholds (106 lines, complexity 30) before this
 * change and after it, because the filters are genuinely many — but each spine
 * is independently small, and grouping them by the spine they target is how
 * the original block was already commented.
 */
function buildReleaseWhere(
  q: SearchReleasesQuery,
  communityIds: number[] | undefined
): Record<string, unknown> {
  const where: Record<string, unknown> = {
    ...buildReleaseTextWhere(q),
    ...buildReleaseScalarWhere(q)
  };

  if (communityIds) where.communityId = { in: communityIds };

  const artist = buildReleaseArtistFilter(q);
  if (artist) where.credits = { some: { artist } };

  const edition = buildEditionFilter(q);
  if (edition) where.editions = { some: edition };

  const contribution = buildContributionFilter(q);
  if (contribution) where.contributions = { some: contribution };

  // Assigned last, so `tagMode=all`'s `AND` array lands on the finished object
  // exactly as it did when this was inline.
  const tagPredicate = buildTagWhere(q.tags, q.tagMode);
  if (tagPredicate) Object.assign(where, tagPredicate);

  return where;
}

/**
 * Restrict a search to rows whose community the caller may reach.
 *
 * Appends to `AND` rather than assigning it. These `where` objects are
 * assembled a key at a time and `tagMode=all` already puts an array there, so
 * a plain assignment would silently drop the tag filter the caller asked for.
 * Every other key is carried through untouched, which keeps the query shape —
 * and the assertions in `search.spec.ts` that record it — intact.
 *
 * The `communityId: null` arm keeps community-less rows visible. `Release`'s
 * `communityId` is nullable, and a bare relation filter excludes a null
 * relation — so without this arm the fix would hide rows that were never
 * private, turning a security fix into a regression. `Request.communityId` is
 * `NOT NULL`, so the arm is inert there and kept only so both call sites read
 * the same.
 */
const scopedToReadableCommunities = (
  where: Record<string, unknown>,
  userId: number
): Record<string, unknown> => {
  // The one definition, in the module named for access (ADR-0036 §2). It is
  // typed for Release; a Request carries the same two fields, and the null arm
  // stays inert there for the reason the doc comment above gives.
  const scope = releaseVisibleToViewer(userId) as Record<string, unknown>;
  const existing = where.AND;
  return {
    ...where,
    AND: Array.isArray(existing)
      ? [...existing, scope]
      : existing
        ? [existing, scope]
        : [scope]
  };
};

// ─── GET /api/search/releases ─────────────────────────────────────────────────

const RELEASE_SELECT = {
  id: true,
  title: true,
  year: true,
  type: true,
  releaseType: true,
  communityId: true,
  description: true,
  createdAt: true,
  credits: releaseCreditsSelect,
  releaseTags: { select: { tag: { select: { id: true, name: true } } } },
  _count: { select: { consumers: true, contributors: true } }
} as const;

router.get(
  '/releases',
  requireAuth,
  validateQuery(searchReleasesQuerySchema),
  authHandler(async (req, res) => {
    const q = parsedQuery<SearchReleasesQuery>(res);
    const pg = parsedPage(res);

    const communityIds = q.communityId
      ? Array.isArray(q.communityId)
        ? q.communityId
        : [q.communityId]
      : undefined;

    const where = buildReleaseWhere(q, communityIds);

    // Every query below reads `scoped`, never `where` — a release in a PRIVATE
    // community the caller does not belong to must not appear in a search, the
    // same rule `listCommunityReleases` enforces on the browse path (#509).
    const scoped = scopedToReadableCommunities(where, req.user.id);

    if (q.orderBy === 'random') {
      const count = await prisma.release.count({ where: scoped });
      const skip =
        count > q.limit ? Math.floor(Math.random() * (count - q.limit)) : 0;
      const data = await prisma.release.findMany({
        where: scoped,
        skip,
        take: q.limit,
        select: RELEASE_SELECT
      });
      return paginatedResponse(
        res,
        data.map((release) => ({
          ...withPrimaryArtist(release),
          tags: release.releaseTags.map((entry) => entry.tag)
        })),
        count,
        pg
      );
    }

    const orderByMap: Record<string, unknown> = {
      createdAt: { createdAt: q.order },
      year: { year: q.order },
      consumers: { consumers: { _count: q.order } },
      contributors: { contributors: { _count: q.order } }
    };

    const [data, total] = await Promise.all([
      prisma.release.findMany({
        where: scoped,
        orderBy: orderByMap[q.orderBy] as never,
        skip: pg.skip,
        take: pg.limit,
        select: RELEASE_SELECT
      }),
      prisma.release.count({ where: scoped })
    ]);

    paginatedResponse(
      res,
      data.map((release) => ({
        ...withPrimaryArtist(release),
        tags: release.releaseTags.map((entry) => entry.tag)
      })),
      total,
      pg
    );
  })
);

// ─── GET /api/search/artists ──────────────────────────────────────────────────

const ARTIST_SELECT = {
  id: true,
  name: true,
  vanityHouse: true,
  tags: { select: { tag: { select: { id: true, name: true } } } },
  _count: { select: { credits: true } }
} as const;

router.get(
  '/artists',
  requireAuth,
  validateQuery(searchArtistsQuerySchema),
  asyncHandler(async (req, res) => {
    const q = parsedQuery<SearchArtistsQuery>(res);
    const pg = parsedPage(res);

    const tagPredicate = buildArtistTagWhere(q.tags, q.tagMode);

    // A withdrawn artist is not a search result (#509 F3 soft delete).
    const where: Record<string, unknown> = { deletedAt: null };
    if (q.q) where.name = { contains: q.q, mode: 'insensitive' };
    if (q.vanityHouse !== undefined) where.vanityHouse = q.vanityHouse;
    if (tagPredicate) Object.assign(where, tagPredicate);

    if (q.orderBy === 'random') {
      const count = await prisma.artist.count({ where });
      const skip =
        count > q.limit ? Math.floor(Math.random() * (count - q.limit)) : 0;
      const data = await prisma.artist.findMany({
        where,
        skip,
        take: q.limit,
        select: ARTIST_SELECT
      });
      return paginatedResponse(res, data, count, pg);
    }

    const [data, total] = await Promise.all([
      prisma.artist.findMany({
        where,
        orderBy: { name: q.order },
        skip: pg.skip,
        take: pg.limit,
        select: ARTIST_SELECT
      }),
      prisma.artist.count({ where })
    ]);

    paginatedResponse(res, data, total, pg);
  })
);

// ─── GET /api/search/requests ─────────────────────────────────────────────────

/**
 * The request `where`, built outside the handler for the same reason
 * `buildReleaseWhere` is: the filters are many and individually trivial, and
 * the handler reads better as "build the filter, scope it, run it".
 */
function buildRequestWhere(q: SearchRequestsQuery): Record<string, unknown> {
  const where: Record<string, unknown> = { deletedAt: null };
  if (q.q) {
    where.OR = [
      { title: { contains: q.q, mode: 'insensitive' } },
      { description: { contains: q.q, mode: 'insensitive' } }
    ];
  }
  if (q.artist)
    where.artists = {
      some: { artist: { name: { contains: q.artist, mode: 'insensitive' } } }
    };
  if (q.type) where.type = q.type;
  if (q.year) where.year = q.year;
  if (q.status) where.status = q.status;
  if (q.communityId) where.communityId = q.communityId;
  return where;
}

const REQUEST_SELECT = {
  id: true,
  title: true,
  description: true,
  type: true,
  year: true,
  status: true,
  voteCount: true,
  communityId: true,
  createdAt: true,
  user: { select: { id: true, username: true } },
  community: { select: { id: true, name: true } },
  artists: { select: { artist: { select: { id: true, name: true } } } },
  bounties: { select: { amount: true } }
} as const;

type RawRequestRow = {
  bounties: { amount: bigint }[];
  [key: string]: unknown;
};

function serializeRequestRow(row: RawRequestRow) {
  const { bounties, ...rest } = row;
  const total = bounties.reduce((acc, b) => acc + BigInt(b.amount), BigInt(0));
  return {
    ...rest,
    totalBounty: total.toString(),
    _count: { bounties: bounties.length }
  };
}

router.get(
  '/requests',
  requireAuth,
  validateQuery(searchRequestsQuerySchema),
  authHandler(async (req, res) => {
    const q = parsedQuery<SearchRequestsQuery>(res);
    const pg = parsedPage(res);

    const where = buildRequestWhere(q);

    // A request belongs to a community and carries its name in the projection,
    // so the same community scope the release search applies belongs here (#509).
    const scoped = scopedToReadableCommunities(where, req.user.id);

    if (q.orderBy === 'random') {
      const count = await prisma.request.count({ where: scoped });
      const skip =
        count > q.limit ? Math.floor(Math.random() * (count - q.limit)) : 0;
      const data = await prisma.request.findMany({
        where: scoped,
        skip,
        take: q.limit,
        select: REQUEST_SELECT
      });
      return paginatedResponse(
        res,
        data.map((r) => serializeRequestRow(r as unknown as RawRequestRow)),
        count,
        pg
      );
    }

    const orderByMap: Record<string, unknown> = {
      createdAt: { createdAt: q.order },
      voteCount: { voteCount: q.order }
    };

    const [data, total] = await Promise.all([
      prisma.request.findMany({
        where: scoped,
        orderBy: orderByMap[q.orderBy] as never,
        skip: pg.skip,
        take: pg.limit,
        select: REQUEST_SELECT
      }),
      prisma.request.count({ where: scoped })
    ]);

    paginatedResponse(
      res,
      data.map((r) => serializeRequestRow(r as unknown as RawRequestRow)),
      total,
      pg
    );
  })
);

// ─── GET /api/search/log ──────────────────────────────────────────────────────

const TOPIC_SELECT = {
  id: true,
  title: true,
  createdAt: true,
  isLocked: true,
  isSticky: true,
  numPosts: true,
  forumId: true,
  author: { select: { id: true, username: true } }
} as const;

const POST_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  forumTopicId: true,
  author: { select: { id: true, username: true } }
} as const;

/**
 * The topic and post filters for a log search, which differ only in the column
 * the free-text term matches and in how each reaches its forum.
 *
 * Forum class travels into the query, because a search has no single `forumId`
 * to hand `assertForumReadAccess` (#509). Without it this route returned the
 * full body of every post on the site — including forums seeded at
 * `minClassRead: 500` — to any authenticated member.
 */
function buildLogWheres(
  user: AuthenticatedRequest['user'],
  q: SearchLogQuery
): { topicWhere: Record<string, unknown>; postWhere: Record<string, unknown> } {
  const readable = forumReadableWhere(user);
  const topicWhere: Record<string, unknown> = {
    deletedAt: null,
    forum: readable
  };
  const postWhere: Record<string, unknown> = {
    deletedAt: null,
    forumTopic: { forum: readable }
  };
  if (q.q) {
    topicWhere.title = { contains: q.q, mode: 'insensitive' };
    postWhere.body = { contains: q.q, mode: 'insensitive' };
  }
  if (q.authorId) {
    topicWhere.authorId = q.authorId;
    postWhere.authorId = q.authorId;
  }
  return { topicWhere, postWhere };
}

type LogPage = { skip: number; limit: number; page: number };

/** One page of topics plus its total, as the three branches all need it. */
const queryTopics = (
  where: Record<string, unknown>,
  orderBy: { createdAt: 'asc' | 'desc' },
  pg: LogPage
) =>
  Promise.all([
    prisma.forumTopic.findMany({
      where,
      orderBy,
      skip: pg.skip,
      take: pg.limit,
      select: TOPIC_SELECT
    }),
    prisma.forumTopic.count({ where })
  ]);

/** The same for posts. */
const queryPosts = (
  where: Record<string, unknown>,
  orderBy: { createdAt: 'asc' | 'desc' },
  pg: LogPage
) =>
  Promise.all([
    prisma.forumPost.findMany({
      where,
      orderBy,
      skip: pg.skip,
      take: pg.limit,
      select: POST_SELECT
    }),
    prisma.forumPost.count({ where })
  ]);

/** `type=all` returns two paginated sections rather than one envelope. */
const logSection = <T>(data: T[], total: number, pg: LogPage) => ({
  data,
  meta: {
    total,
    page: pg.page,
    limit: pg.limit,
    totalPages: Math.ceil(total / pg.limit)
  }
});

router.get(
  '/log',
  requireAuth,
  validateQuery(searchLogQuerySchema),
  authHandler(async (req, res) => {
    const q = parsedQuery<SearchLogQuery>(res);
    const pg = parsedPage(res);

    const { topicWhere, postWhere } = buildLogWheres(req.user, q);
    const orderBy = { createdAt: q.order } as const;

    if (q.type === 'topic') {
      const [data, total] = await queryTopics(topicWhere, orderBy, pg);
      return paginatedResponse(res, data, total, pg);
    }

    if (q.type === 'post') {
      const [data, total] = await queryPosts(postWhere, orderBy, pg);
      return paginatedResponse(res, data, total, pg);
    }

    // type === 'all' — still one round of concurrent queries, as before.
    const [[topics, topicTotal], [posts, postTotal]] = await Promise.all([
      queryTopics(topicWhere, orderBy, pg),
      queryPosts(postWhere, orderBy, pg)
    ]);

    res.json({
      topics: logSection(topics, topicTotal, pg),
      posts: logSection(posts, postTotal, pg)
    });
  })
);

// ─── GET /api/search/users ────────────────────────────────────────────────────

const USER_SELECT_PUBLIC = {
  id: true,
  username: true,
  createdAt: true,
  userRank: { select: { name: true, color: true } }
} as const;

const USER_SELECT_STAFF = {
  ...USER_SELECT_PUBLIC,
  email: true,
  lastLogin: true,
  disabled: true,
  contributed: true,
  consumed: true
} as const;

router.get(
  '/users',
  requireAuth,
  validateQuery(searchUsersQuerySchema),
  asyncHandler(async (req, res) => {
    const q = parsedQuery<SearchUsersQuery>(res);
    const pg = parsedPage(res);
    const authedReq = req as AuthenticatedRequest;

    const rank = await prisma.userRank.findUnique({
      where: { id: authedReq.user.userRankId },
      select: { permissions: true }
    });
    const perms = (rank?.permissions ?? {}) as Record<string, boolean>;
    const isPrivileged = !!(perms.users_search || perms.staff || perms.admin);

    if (!isPrivileged) {
      // Basic search — username only, non-disabled users
      const where: Record<string, unknown> = { disabled: false };
      if (q.q) where.username = { contains: q.q, mode: 'insensitive' };
      const [data, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { username: q.order },
          skip: pg.skip,
          take: pg.limit,
          select: USER_SELECT_PUBLIC
        }),
        prisma.user.count({ where })
      ]);
      return paginatedResponse(res, data, total, pg);
    }

    const where: Record<string, unknown> = {};
    if (q.q) {
      where.OR = [
        { username: { contains: q.q, mode: 'insensitive' } },
        { email: { contains: q.q, mode: 'insensitive' } }
      ];
    }
    if (q.disabled !== undefined) where.disabled = q.disabled;

    const orderByMap: Record<string, unknown> = {
      username: { username: q.order },
      createdAt: { createdAt: q.order },
      lastLogin: { lastLogin: q.order }
    };

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: orderByMap[q.orderBy] as never,
        skip: pg.skip,
        take: pg.limit,
        select: USER_SELECT_STAFF
      }),
      prisma.user.count({ where })
    ]);

    // `ratio` is derived from contributed/consumed at read time, not stored.
    const rows = data.map((u) => ({
      ...u,
      ratio: computeRatio(u.contributed, u.consumed)
    }));

    paginatedResponse(res, rows, total, pg);
  })
);

export default router;
