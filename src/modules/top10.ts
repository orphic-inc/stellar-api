import { Prisma, Top10SnapshotType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { computeRatio } from './ratio';
import { primaryArtist } from './releaseCredits';
import type {
  ReleasesQuery,
  UsersQuery,
  TagsQuery,
  VotesQuery,
  HistoryQuery
} from '../schemas/top10';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TopReleaseItem = {
  rank: number;
  releaseId: number;
  title: string;
  year: number;
  artistId: number;
  artistName: string;
  type: string;
  releaseType: string;
  tags: Array<{ id: number; name: string }>;
  consumerCount: number;
  totalBytesConsumed: string;
  contributionCount: number;
};

export type TopUserItem = {
  rank: number;
  userId: number;
  username: string;
  avatar: string | null;
  contributed: string;
  consumed: string;
  ratio: number;
  numContributions: number;
  contributionSpeed: number;
  consumeSpeed: number;
  joinedAt: string;
  rankName: string;
  rankLevel: number;
};

export type TopTagItem = {
  rank: number;
  tagId: number;
  name: string;
  uses: number;
  positiveVotes: number;
  negativeVotes: number;
};

export type TopVoteItem = {
  rank: number;
  releaseId: number;
  title: string;
  year: number;
  artistName: string;
  ups: number;
  downs: number;
  total: number;
  score: number;
  positivePercent: number;
};

export type HistorySnapshotResult = {
  snapshotId: number;
  type: string;
  date: string;
  entries: Array<{
    rank: number;
    releaseId: number | null;
    releaseTitle: string;
    tagString: string;
    deleted: boolean;
  }>;
} | null;

// ─── BPCI ─────────────────────────────────────────────────────────────────────

const Z_VAL = 1.281728756502709; // 90% confidence lower bound

export function binomialScore(ups: number, total: number): number {
  if (total <= 0 || ups < 0) return 0;
  const phat = ups / total;
  const zSq = Z_VAL * Z_VAL;
  const numerator =
    phat +
    zSq / (2 * total) -
    Z_VAL * Math.sqrt((phat * (1 - phat) + zSq / (4 * total)) / total);
  return numerator / (1 + zSq / total);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function windowStart(type: string): Date | null {
  const now = new Date();
  switch (type) {
    case 'day':
      return new Date(now.getTime() - 86_400_000);
    case 'week':
      return new Date(now.getTime() - 7 * 86_400_000);
    case 'month':
      return new Date(now.getTime() - 30 * 86_400_000);
    case 'year':
      return new Date(now.getTime() - 365 * 86_400_000);
    default:
      return null;
  }
}

async function resolveExcludeTagIds(excludeTags?: string): Promise<number[]> {
  if (!excludeTags) return [];
  const names = excludeTags
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) return [];
  const tags = await prisma.tag.findMany({
    where: { name: { in: names } },
    select: { id: true }
  });
  return tags.map((t) => t.id);
}

async function attachTags(
  releaseIds: number[]
): Promise<Map<number, Array<{ id: number; name: string }>>> {
  const releaseTags = await prisma.releaseTag.findMany({
    where: { releaseId: { in: releaseIds } },
    select: {
      releaseId: true,
      tag: { select: { id: true, name: true } }
    }
  });
  const map = new Map<number, Array<{ id: number; name: string }>>();
  for (const releaseId of releaseIds) map.set(releaseId, []);
  for (const row of releaseTags) {
    const tags = map.get(row.releaseId) ?? [];
    tags.push(row.tag);
    map.set(row.releaseId, tags);
  }
  return map;
}

// ─── Releases ─────────────────────────────────────────────────────────────────

type ReleaseRow = {
  id: bigint;
  title: string;
  year: number;
  type: string;
  releaseType: string;
  consumerCount: number;
  totalBytesConsumed: bigint;
  contributionCount: number;
};

/**
 * The chart's release scope (ADR-0036 §3).
 *
 * Top 10 is a SITE-WIDE chart, so it ranks only releases in public
 * communities — a release in a `PRIVATE` community is absent for everyone,
 * including that community's own members, who see their own rankings through
 * the community-scoped surfaces instead.
 *
 * This is deliberately NOT `releaseVisibleToViewer`. That predicate answers
 * "may this viewer see this release" and would make the chart viewer-dependent,
 * which ADR-0036 §3 rejects: renumbering per viewer makes "the #1 release this
 * week" unstateable, and preserving the global ranks with gaps tells a
 * non-member exactly how many hidden releases outrank what they can see. The
 * predicate here is viewer-independent and static, which is also why restating
 * it in SQL is safe where restating the access rule would not be (ADR-0036 §2,
 * amended 2026-09-09).
 *
 * The `communityId IS NULL` arm is load-bearing for the same reason it is
 * everywhere else: the column is nullable, and a release that belongs to no
 * community was never private.
 */
const chartableRelease = Prisma.sql`
  AND (
    r."communityId" IS NULL
    OR EXISTS (
      SELECT 1 FROM communities c2
      WHERE c2.id = r."communityId"
        AND c2."registrationStatus" = 'open'::"RegistrationStatus"
    )
  )`;

/**
 * A release with no credited artist has never appeared in this chart.
 *
 * It used to be excluded by `INNER JOIN artists a ON a.id = r."artistId"` — a
 * column #72 dropped, which is why every branch of this query answered 500
 * until now (#608). The exclusion is preserved as an EXISTS so the semantics
 * survive without multiplying rows into the aggregate, and the artist itself is
 * derived afterwards through `primaryArtist`, the one place that rule lives.
 */
const hasCreditedArtist = Prisma.sql`
  AND EXISTS (SELECT 1 FROM release_artists ra WHERE ra."releaseId" = r.id)`;

/** The columns and grouping every branch shares. Kept together so a column
 *  added to the SELECT cannot be forgotten in the GROUP BY. */
const releaseColumns = Prisma.sql`
        r.id,
        r.title,
        r.year,
        r.type,
        r."releaseType"`;

const releaseGrouping = Prisma.sql`
      GROUP BY r.id, r.title, r.year, r.type, r."releaseType"`;

const rankByContributions = (
  tagFilter: Prisma.Sql,
  formatFilter: Prisma.Sql,
  limit: number
) => prisma.$queryRaw<ReleaseRow[]>`
      SELECT
        ${releaseColumns},
        COUNT(c.id)::int AS "consumerCount",
        0::bigint        AS "totalBytesConsumed",
        COUNT(c.id)::int AS "contributionCount"
      FROM releases r
      INNER JOIN contributions c ON c."releaseId" = r.id
      WHERE 1=1
      ${chartableRelease}
      ${hasCreditedArtist}
      ${tagFilter}
      ${formatFilter}
      ${releaseGrouping}
      ORDER BY "contributionCount" DESC
      LIMIT ${limit}
    `;

const rankByBytesConsumed = (
  tagFilter: Prisma.Sql,
  formatFilter: Prisma.Sql,
  limit: number
) => prisma.$queryRaw<ReleaseRow[]>`
      SELECT
        ${releaseColumns},
        COUNT(DISTINCT dag."consumerId")::int AS "consumerCount",
        COALESCE(SUM(dag."amountBytes"), 0)   AS "totalBytesConsumed",
        COUNT(DISTINCT c.id)::int             AS "contributionCount"
      FROM releases r
      INNER JOIN contributions c ON c."releaseId" = r.id
      INNER JOIN download_access_grants dag
        ON dag."contributionId" = c.id AND dag.status = 'COMPLETED'
      WHERE 1=1
      ${chartableRelease}
      ${hasCreditedArtist}
      ${tagFilter}
      ${formatFilter}
      ${releaseGrouping}
      ORDER BY "totalBytesConsumed" DESC
      LIMIT ${limit}
    `;

const rankByConsumers = (
  windowFilter: Prisma.Sql,
  tagFilter: Prisma.Sql,
  formatFilter: Prisma.Sql,
  limit: number
) => prisma.$queryRaw<ReleaseRow[]>`
      SELECT
        ${releaseColumns},
        COUNT(DISTINCT dag."consumerId")::int AS "consumerCount",
        COALESCE(SUM(dag."amountBytes"), 0)   AS "totalBytesConsumed",
        COUNT(DISTINCT c.id)::int             AS "contributionCount"
      FROM releases r
      INNER JOIN contributions c ON c."releaseId" = r.id
      INNER JOIN download_access_grants dag
        ON dag."contributionId" = c.id AND dag.status = 'COMPLETED'
      WHERE 1=1
      ${chartableRelease}
      ${hasCreditedArtist}
      ${windowFilter}
      ${tagFilter}
      ${formatFilter}
      ${releaseGrouping}
      ORDER BY "consumerCount" DESC
      LIMIT ${limit}
    `;

/**
 * The credited artist for each ranked release, derived through
 * `primaryArtist` rather than re-implemented in SQL.
 *
 * A second query, in the shape `attachTags` already established. The
 * alternative — a LATERAL join picking the Main credit — would restate
 * `primaryArtist`'s "prefer Main, else the first credit" rule in SQL, and
 * `releaseCredits.ts` exists precisely so that rule has one home.
 */
async function attachArtists(
  releaseIds: number[]
): Promise<Map<number, { id: number; name: string }>> {
  const credits = await prisma.releaseArtist.findMany({
    where: { releaseId: { in: releaseIds } },
    select: {
      releaseId: true,
      role: true,
      artist: { select: { id: true, name: true } }
    }
  });
  const byRelease = new Map<number, typeof credits>();
  for (const credit of credits) {
    const existing = byRelease.get(credit.releaseId) ?? [];
    existing.push(credit);
    byRelease.set(credit.releaseId, existing);
  }
  const map = new Map<number, { id: number; name: string }>();
  for (const [releaseId, rows] of byRelease) {
    const artist = primaryArtist(rows);
    if (artist) map.set(releaseId, artist);
  }
  return map;
}

export async function getTopReleases(
  params: ReleasesQuery
): Promise<TopReleaseItem[]> {
  const { type, limit, excludeTags, format } = params;
  const excludeTagIds = await resolveExcludeTagIds(excludeTags);

  const tagFilter =
    excludeTagIds.length > 0
      ? Prisma.sql`AND NOT EXISTS (
          SELECT 1 FROM release_tags rt
          WHERE rt."releaseId" = r.id AND rt."tagId" = ANY(${excludeTagIds}::int[])
        )`
      : Prisma.empty;

  const formatFilter = format
    ? Prisma.sql`AND c.type = ${format}::"FileType"`
    : Prisma.empty;

  let rows: ReleaseRow[];

  if (type === 'contributed') {
    rows = await rankByContributions(tagFilter, formatFilter, limit);
  } else if (type === 'consumed') {
    rows = await rankByBytesConsumed(tagFilter, formatFilter, limit);
  } else {
    const win = windowStart(type);
    const windowFilter = win
      ? Prisma.sql`AND dag."createdAt" >= ${win}`
      : Prisma.empty;
    rows = await rankByConsumers(windowFilter, tagFilter, formatFilter, limit);
  }

  const releaseIds = rows.map((r) => Number(r.id));
  const [tagMap, artistMap] = await Promise.all([
    attachTags(releaseIds),
    attachArtists(releaseIds)
  ]);

  return rows.flatMap((row, i) => {
    const releaseId = Number(row.id);
    const artist = artistMap.get(releaseId);
    // `hasCreditedArtist` guarantees a credit at ranking time, so this only
    // fires if the last one was deleted between the two queries. Dropping the
    // row keeps `artistId`/`artistName` non-null rather than widening the
    // contract for a race; `rank` comes from the SQL position, so the surviving
    // rows keep the rank they actually held.
    if (!artist) return [];
    return [
      {
        rank: i + 1,
        releaseId,
        title: row.title,
        year: row.year,
        artistId: artist.id,
        artistName: artist.name,
        type: row.type,
        releaseType: row.releaseType,
        tags: tagMap.get(releaseId) ?? [],
        consumerCount: Number(row.consumerCount),
        totalBytesConsumed: String(row.totalBytesConsumed),
        contributionCount: Number(row.contributionCount)
      }
    ];
  });
}

// ─── Users ────────────────────────────────────────────────────────────────────

type SpeedRow = {
  id: bigint;
  username: string;
  avatar: string | null;
  contributed: bigint;
  consumed: bigint;
  dateRegistered: Date;
  rankName: string;
  rankLevel: number;
  numContributions: bigint;
  contributionSpeed: number;
  consumeSpeed: number;
};

export async function getTopUsers(params: UsersQuery): Promise<TopUserItem[]> {
  const { type, limit } = params;

  if (type === 'contributionSpeed' || type === 'consumeSpeed') {
    const orderCol =
      type === 'contributionSpeed'
        ? Prisma.sql`"contributionSpeed"`
        : Prisma.sql`"consumeSpeed"`;

    const rows = await prisma.$queryRaw<SpeedRow[]>`
      SELECT
        u.id,
        u.username,
        u.avatar,
        u.contributed,
        u.consumed,
        u."dateRegistered",
        ur.name AS "rankName",
        ur.level AS "rankLevel",
        COUNT(c.id)::bigint AS "numContributions",
        CASE
          WHEN EXTRACT(EPOCH FROM (NOW() - u."dateRegistered")) > 0
          THEN u.contributed::float / EXTRACT(EPOCH FROM (NOW() - u."dateRegistered"))
          ELSE 0
        END AS "contributionSpeed",
        CASE
          WHEN EXTRACT(EPOCH FROM (NOW() - u."dateRegistered")) > 0
          THEN u.consumed::float / EXTRACT(EPOCH FROM (NOW() - u."dateRegistered"))
          ELSE 0
        END AS "consumeSpeed"
      FROM users u
      INNER JOIN user_ranks ur ON ur.id = u."userRankId"
      INNER JOIN user_settings us ON us.id = u."userSettingsId"
      LEFT JOIN contributions c ON c."userId" = u.id
      WHERE u.disabled = false
        AND u.contributed > 0
        AND us."showContributedStats" = true
        AND us."showConsumedStats" = true
      GROUP BY u.id, u.username, u.avatar, u.contributed, u.consumed,
               u."dateRegistered", ur.name, ur.level
      ORDER BY ${orderCol} DESC
      LIMIT ${limit}
    `;

    return rows.map((row, i) => ({
      rank: i + 1,
      userId: Number(row.id),
      username: row.username,
      avatar: row.avatar,
      contributed: String(row.contributed),
      consumed: String(row.consumed),
      ratio: computeRatio(row.contributed, row.consumed),
      numContributions: Number(row.numContributions),
      contributionSpeed: Number(row.contributionSpeed),
      consumeSpeed: Number(row.consumeSpeed),
      joinedAt: row.dateRegistered.toISOString(),
      rankName: row.rankName,
      rankLevel: row.rankLevel
    }));
  }

  const privacyFilter =
    type === 'consumed'
      ? { showConsumedStats: true }
      : { showContributedStats: true };

  const orderBy: Prisma.UserOrderByWithRelationInput[] =
    type === 'numContributions'
      ? [{ contributions: { _count: 'desc' } }, { id: 'asc' }]
      : type === 'consumed'
        ? [{ consumed: 'desc' }, { id: 'asc' }]
        : [{ contributed: 'desc' }, { id: 'asc' }];

  const users = await prisma.user.findMany({
    where: {
      disabled: false,
      contributed: { gt: 0 },
      userSettings: privacyFilter
    },
    orderBy,
    take: limit,
    select: {
      id: true,
      username: true,
      avatar: true,
      contributed: true,
      consumed: true,
      dateRegistered: true,
      userRank: { select: { name: true, level: true } },
      _count: { select: { contributions: true } }
    }
  });

  return users.map((u, i) => {
    const secondsAlive = (Date.now() - u.dateRegistered.getTime()) / 1000 || 1;
    return {
      rank: i + 1,
      userId: u.id,
      username: u.username,
      avatar: u.avatar,
      contributed: String(u.contributed),
      consumed: String(u.consumed),
      ratio: computeRatio(u.contributed, u.consumed),
      numContributions: u._count.contributions,
      contributionSpeed: Number(u.contributed) / secondsAlive,
      consumeSpeed: Number(u.consumed) / secondsAlive,
      joinedAt: u.dateRegistered.toISOString(),
      rankName: u.userRank.name,
      rankLevel: u.userRank.level
    };
  });
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

type VotedTagRow = {
  id: bigint;
  name: string;
  occurrences: number;
  positiveVotes: number;
  negativeVotes: number;
};

export async function getTopTags(params: TagsQuery): Promise<TopTagItem[]> {
  const { type, limit } = params;

  if (type === 'voted') {
    const rows = await prisma.$queryRaw<VotedTagRow[]>`
      SELECT
        t.id,
        t.name,
        t.occurrences,
        COALESCE(SUM(at."positiveVotes" - 1), 0)::int AS "positiveVotes",
        COALESCE(SUM(at."negativeVotes" - 1), 0)::int AS "negativeVotes"
      FROM tags t
      LEFT JOIN artist_tags at ON at."tagId" = t.id
      GROUP BY t.id, t.name, t.occurrences
      HAVING COALESCE(SUM(at."positiveVotes" - 1), 0) > 0
      ORDER BY "positiveVotes" DESC, t.name
      LIMIT ${limit}
    `;

    return rows.map((row, i) => ({
      rank: i + 1,
      tagId: Number(row.id),
      name: row.name,
      uses: row.occurrences,
      positiveVotes: row.positiveVotes,
      negativeVotes: row.negativeVotes
    }));
  }

  // type === 'used'
  const tags = await prisma.tag.findMany({
    where: { occurrences: { gt: 0 } },
    orderBy: [{ occurrences: 'desc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, name: true, occurrences: true }
  });

  return tags.map((t, i) => ({
    rank: i + 1,
    tagId: t.id,
    name: t.name,
    uses: t.occurrences,
    positiveVotes: 0,
    negativeVotes: 0
  }));
}

// ─── Votes ────────────────────────────────────────────────────────────────────

export async function getTopVotedReleases(
  params: VotesQuery
): Promise<TopVoteItem[]> {
  const { limit, tags, year } = params;

  const tagFilter =
    tags && tags.trim()
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM release_tags rt
          INNER JOIN tags tg ON tg.id = rt."tagId"
          WHERE rt."releaseId" = r.id
            AND tg.name = ANY(${tags
              .split(',')
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)}::text[])
        )`
      : Prisma.empty;

  const yearFilter = year ? Prisma.sql`AND r.year = ${year}` : Prisma.empty;

  type VoteRow = {
    id: bigint;
    title: string;
    year: number;
    artistName: string;
    ups: number;
    total: number;
    score: number;
  };

  const rows = await prisma.$queryRaw<VoteRow[]>`
    SELECT
      r.id,
      r.title,
      r.year,
      a.name AS "artistName",
      va.ups,
      va.total,
      va.score
    FROM release_vote_aggregates va
    INNER JOIN releases r ON r.id = va."releaseId"
    INNER JOIN artists a ON a.id = r."artistId"
    WHERE va.score > 0
      AND va.total >= 3
      ${tagFilter}
      ${yearFilter}
    ORDER BY va.score DESC
    LIMIT ${limit}
  `;

  return rows.map((row, i) => {
    const ups = Number(row.ups);
    const total = Number(row.total);
    return {
      rank: i + 1,
      releaseId: Number(row.id),
      title: row.title,
      year: row.year,
      artistName: row.artistName,
      ups,
      downs: total - ups,
      total,
      score: Number(row.score),
      positivePercent: total > 0 ? Math.round((ups / total) * 1000) / 10 : 0
    };
  });
}

// ─── Vote mutations ───────────────────────────────────────────────────────────

export async function recomputeVoteAggregate(releaseId: number): Promise<void> {
  const [total, ups] = await Promise.all([
    prisma.releaseVote.count({ where: { releaseId } }),
    prisma.releaseVote.count({ where: { releaseId, positive: true } })
  ]);

  const score = binomialScore(ups, total);

  await prisma.releaseVoteAggregate.upsert({
    where: { releaseId },
    create: { releaseId, ups, total, score },
    update: { ups, total, score }
  });
}

// ─── History ──────────────────────────────────────────────────────────────────

export async function getHistorySnapshot(
  params: HistoryQuery
): Promise<HistorySnapshotResult> {
  const { type, date } = params;

  let dateFilter: Prisma.Top10SnapshotWhereInput;
  if (date) {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    dateFilter = { type, createdAt: { gte: start, lte: end } };
  } else {
    dateFilter = { type };
  }

  const snapshot = await prisma.top10Snapshot.findFirst({
    where: dateFilter,
    orderBy: { createdAt: 'desc' },
    include: {
      entries: {
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        include: {
          release: { select: { id: true } }
        }
      }
    }
  });

  if (!snapshot) return null;

  return {
    snapshotId: snapshot.id,
    type: snapshot.type,
    date: snapshot.createdAt.toISOString(),
    entries: snapshot.entries.map((e) => ({
      rank: e.rank,
      releaseId: e.releaseId,
      releaseTitle: e.releaseTitle,
      tagString: e.tagString,
      deleted: e.releaseId !== null && e.release === null
    }))
  };
}

// Which leaderboard WINDOW each snapshot type captures. This map is the whole
// point of the type: a Weekly snapshot is the week's top 10, not a weekly
// capture of the daily one. Before #491 the window was hardcoded to 'day' and
// `type` was written to the column as a label only, so every row labelled
// Weekly held daily data and GET /top10/history served it as if it did not.
const SNAPSHOT_WINDOW = {
  Daily: 'day',
  Weekly: 'week'
} as const satisfies Record<Top10SnapshotType, ReleasesQuery['type']>;

export async function createSnapshot(type: Top10SnapshotType): Promise<void> {
  const top = await getTopReleases({ type: SNAPSHOT_WINDOW[type], limit: 10 });

  await prisma.top10Snapshot.create({
    data: {
      type,
      entries: {
        create: top.map((r) => ({
          rank: r.rank,
          releaseId: r.releaseId,
          releaseTitle: `${r.artistName} – ${r.title} [${r.year}]`,
          tagString: r.tags.map((t) => t.name).join(', ')
        }))
      }
    }
  });
}
