import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
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
  artistId: bigint;
  artistName: string;
  type: string;
  releaseType: string;
  consumerCount: number;
  totalBytesConsumed: bigint;
  contributionCount: number;
};

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
    rows = await prisma.$queryRaw<ReleaseRow[]>`
      SELECT
        r.id,
        r.title,
        r.year,
        r."artistId",
        a.name AS "artistName",
        r.type,
        r."releaseType",
        COUNT(c.id)::int AS "consumerCount",
        0::bigint        AS "totalBytesConsumed",
        COUNT(c.id)::int AS "contributionCount"
      FROM releases r
      INNER JOIN artists a ON a.id = r."artistId"
      INNER JOIN contributions c ON c."releaseId" = r.id
      WHERE 1=1
      ${tagFilter}
      ${formatFilter}
      GROUP BY r.id, r.title, r.year, r."artistId", a.name, r.type, r."releaseType"
      ORDER BY "contributionCount" DESC
      LIMIT ${limit}
    `;
  } else if (type === 'consumed') {
    rows = await prisma.$queryRaw<ReleaseRow[]>`
      SELECT
        r.id,
        r.title,
        r.year,
        r."artistId",
        a.name AS "artistName",
        r.type,
        r."releaseType",
        COUNT(DISTINCT dag."consumerId")::int AS "consumerCount",
        COALESCE(SUM(dag."amountBytes"), 0)   AS "totalBytesConsumed",
        COUNT(DISTINCT c.id)::int             AS "contributionCount"
      FROM releases r
      INNER JOIN artists a ON a.id = r."artistId"
      INNER JOIN contributions c ON c."releaseId" = r.id
      INNER JOIN download_access_grants dag
        ON dag."contributionId" = c.id AND dag.status = 'COMPLETED'
      WHERE 1=1
      ${tagFilter}
      ${formatFilter}
      GROUP BY r.id, r.title, r.year, r."artistId", a.name, r.type, r."releaseType"
      ORDER BY "totalBytesConsumed" DESC
      LIMIT ${limit}
    `;
  } else {
    const win = windowStart(type);
    const windowFilter = win
      ? Prisma.sql`AND dag."createdAt" >= ${win}`
      : Prisma.empty;

    rows = await prisma.$queryRaw<ReleaseRow[]>`
      SELECT
        r.id,
        r.title,
        r.year,
        r."artistId",
        a.name AS "artistName",
        r.type,
        r."releaseType",
        COUNT(DISTINCT dag."consumerId")::int AS "consumerCount",
        COALESCE(SUM(dag."amountBytes"), 0)   AS "totalBytesConsumed",
        COUNT(DISTINCT c.id)::int             AS "contributionCount"
      FROM releases r
      INNER JOIN artists a ON a.id = r."artistId"
      INNER JOIN contributions c ON c."releaseId" = r.id
      INNER JOIN download_access_grants dag
        ON dag."contributionId" = c.id AND dag.status = 'COMPLETED'
      WHERE 1=1
      ${windowFilter}
      ${tagFilter}
      ${formatFilter}
      GROUP BY r.id, r.title, r.year, r."artistId", a.name, r.type, r."releaseType"
      ORDER BY "consumerCount" DESC
      LIMIT ${limit}
    `;
  }

  const releaseIds = rows.map((r) => Number(r.id));
  const tagMap = await attachTags(releaseIds);

  return rows.map((row, i) => ({
    rank: i + 1,
    releaseId: Number(row.id),
    title: row.title,
    year: row.year,
    artistId: Number(row.artistId),
    artistName: row.artistName,
    type: row.type,
    releaseType: row.releaseType,
    tags: tagMap.get(Number(row.id)) ?? [],
    consumerCount: Number(row.consumerCount),
    totalBytesConsumed: String(row.totalBytesConsumed),
    contributionCount: Number(row.contributionCount)
  }));
}

// ─── Users ────────────────────────────────────────────────────────────────────

type SpeedRow = {
  id: bigint;
  username: string;
  avatar: string | null;
  contributed: bigint;
  consumed: bigint;
  ratio: number;
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
        u.ratio,
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
      GROUP BY u.id, u.username, u.avatar, u.contributed, u.consumed, u.ratio,
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
      ratio: row.ratio,
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

  const orderBy: Prisma.UserOrderByWithRelationInput =
    type === 'numContributions'
      ? { contributions: { _count: 'desc' } }
      : type === 'consumed'
      ? { consumed: 'desc' }
      : { contributed: 'desc' };

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
      ratio: true,
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
      ratio: u.ratio,
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
    orderBy: { occurrences: 'desc' },
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
        orderBy: { rank: 'asc' },
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

export async function createSnapshot(type: 'Daily' | 'Weekly'): Promise<void> {
  const top = await getTopReleases({ type: 'day', limit: 10 });

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
