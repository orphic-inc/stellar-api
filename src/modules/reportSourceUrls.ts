import type { CommentPage, ReportTargetType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { canAccessForumLevel } from '../lib/userRankAccess';
import type { AuthUser } from '../types/auth';
import { canSeeThreadOf } from './comment';
import { releaseVisibleTo } from './communityAccess';
import { releasesUnderOpenReport } from './reportedRelease';

// ─── UI deep-link paths ───────────────────────────────────────────────────────

/**
 * The UI routes a report's `sourceUrl` points at.
 *
 * Named rather than spelled inline because several repeat — the release path
 * four times, artists, collages and forum topics twice each — so a route change
 * is one edit per shape instead of hunting fourteen literals. Which is how the
 * last one was missed: these all carried a `/private/` prefix that the 0.8.x
 * flattening removed from the UI's route model, and every link had been leaning
 * on stellar-ui's `LegacyPrivateRedirect` shim to resolve (#338).
 *
 * `userPath` takes a username deliberately: the UI route reads `user/:id`, but
 * `getProfileByLookup` resolves a numeric id *or* a case-insensitive username.
 */
const userPath = (username: string): string => `/user/${username}`;
const releasePath = (communityId: number, releaseId: number): string =>
  `/communities/${communityId}/releases/${releaseId}`;
const topicPath = (forumId: number, topicId: number): string =>
  `/forums/${forumId}/topics/${topicId}`;
const artistPath = (artistId: number): string => `/artists/${artistId}`;
const collagePath = (collageId: number): string => `/collages/${collageId}`;
const requestPath = (requestId: number): string => `/requests/${requestId}`;
const communityPath = (communityId: number): string =>
  `/communities/${communityId}`;

// ─── Source URL resolution ────────────────────────────────────────────────────

/**
 * Whose report list the links are for (#773). A reporter sees a link only to a
 * target they may see: one they cannot answers `null`, exactly as a target that
 * no longer exists does, so their own list cannot confirm a hidden id or name
 * the community or forum holding it.
 */
export type SourceViewer = Pick<
  AuthUser,
  'id' | 'userRankLevel' | 'permittedForumIds'
>;

/**
 * A `reports_manage` holder reading the queue. They see every link except one
 * into a release page that would refuse them: a release they cannot see as a
 * member and that no open report concerns (ADR-0055 §3, #905).
 */
export type StaffSourceViewer = { staffId: number };

type Entry = { reportId: number; targetId: number };
type Resolved = Array<[reportId: number, url: string | null]>;
type Viewer = SourceViewer | StaffSourceViewer;
type Resolver = (entries: Entry[], viewer: Viewer) => Promise<Resolved>;

/** The reporter, when it is a reporter's list; staff pass every check below it. */
const reporterOf = (viewer: Viewer): SourceViewer | undefined =>
  'staffId' in viewer ? undefined : viewer;

const idsOf = (entries: Entry[]) => entries.map((e) => e.targetId);

/** Each entry's url from a by-target-id lookup; a target not found is null. */
const byTarget = <T>(
  entries: Entry[],
  rows: Map<number, T>,
  url: (row: T, targetId: number) => string | null
): Resolved =>
  entries.map(({ reportId, targetId }) => {
    const row = rows.get(targetId);
    return [reportId, row === undefined ? null : url(row, targetId)];
  });

/** Every entry's url from its id alone: the page is site-wide. */
const fromId =
  (path: (id: number) => string): Resolver =>
  async (entries) =>
    entries.map(({ reportId, targetId }) => [reportId, path(targetId)]);

/**
 * Which of these releases the viewer's release page will open for: as a
 * member, or, for staff, because an open report concerns it.
 */
const openableReleases = async (
  releaseIds: number[],
  viewer: Viewer
): Promise<Set<number>> => {
  if (releaseIds.length === 0) return new Set();
  const reporter = reporterOf(viewer);
  const [visible, reported] = await Promise.all([
    prisma.release.findMany({
      where: {
        AND: [
          { id: { in: releaseIds } },
          releaseVisibleTo('staffId' in viewer ? viewer.staffId : viewer.id)
        ]
      },
      select: { id: true }
    }),
    reporter ? new Set<number>() : releasesUnderOpenReport(releaseIds)
  ]);
  return new Set([...visible.map((r) => r.id), ...reported]);
};

const forumReadable = (
  viewer: Viewer,
  forum: { id: number; minClassRead: number }
) => {
  const reporter = reporterOf(viewer);
  return (
    !reporter || canAccessForumLevel(reporter, forum.id, forum.minClassRead)
  );
};

const resolveUsers: Resolver = async (entries) => {
  const users = await prisma.user.findMany({
    where: { id: { in: idsOf(entries) } },
    select: { id: true, username: true }
  });
  return byTarget(entries, new Map(users.map((u) => [u.id, u])), (u) =>
    userPath(u.username)
  );
};

const resolveReleases: Resolver = async (entries, viewer) => {
  const releases = await prisma.release.findMany({
    where: { id: { in: idsOf(entries) } },
    select: { id: true, communityId: true }
  });
  const openable = await openableReleases(
    releases.map((r) => r.id),
    viewer
  );
  return byTarget(entries, new Map(releases.map((r) => [r.id, r])), (r, id) =>
    r.communityId && openable.has(id) ? releasePath(r.communityId, id) : null
  );
};

const resolveContributions: Resolver = async (entries, viewer) => {
  const contribs = await prisma.contribution.findMany({
    where: { id: { in: idsOf(entries) } },
    select: {
      id: true,
      releaseId: true,
      release: { select: { communityId: true } }
    }
  });
  const openable = await openableReleases(
    contribs.map((c) => c.releaseId),
    viewer
  );
  return byTarget(entries, new Map(contribs.map((c) => [c.id, c])), (c) =>
    c.release?.communityId && openable.has(c.releaseId)
      ? releasePath(c.release.communityId, c.releaseId)
      : null
  );
};

const resolveTopics: Resolver = async (entries, viewer) => {
  const topics = await prisma.forumTopic.findMany({
    where: { id: { in: idsOf(entries) } },
    select: { id: true, forum: { select: { id: true, minClassRead: true } } }
  });
  return byTarget(entries, new Map(topics.map((t) => [t.id, t])), (t, id) =>
    forumReadable(viewer, t.forum) ? topicPath(t.forum.id, id) : null
  );
};

const resolvePosts: Resolver = async (entries, viewer) => {
  const posts = await prisma.forumPost.findMany({
    where: { id: { in: idsOf(entries) } },
    select: {
      id: true,
      forumTopicId: true,
      forumTopic: {
        select: { forum: { select: { id: true, minClassRead: true } } }
      }
    }
  });
  return byTarget(entries, new Map(posts.map((p) => [p.id, p])), (p) =>
    forumReadable(viewer, p.forumTopic.forum)
      ? topicPath(p.forumTopic.forum.id, p.forumTopicId)
      : null
  );
};

const commentSelect = {
  id: true,
  page: true,
  artistId: true,
  releaseId: true,
  release: { select: { communityId: true } },
  collageId: true,
  requestId: true,
  communityId: true,
  contributionId: true,
  contribution: {
    select: { releaseId: true, release: { select: { communityId: true } } }
  }
} as const;

type CommentRow = Awaited<
  ReturnType<typeof prisma.comment.findMany<{ select: typeof commentSelect }>>
>[number];

/**
 * The page each kind of comment sits on, or null when it cannot be linked. A
 * `Record` over `CommentPage`, as `THREAD_CHECKS` in comment.ts is.
 */
const COMMENT_URLS: Record<CommentPage, (c: CommentRow) => string | null> = {
  artist: (c) => (c.artistId ? artistPath(c.artistId) : null),
  release: (c) =>
    c.releaseId && c.release?.communityId
      ? releasePath(c.release.communityId, c.releaseId)
      : null,
  collages: (c) => (c.collageId ? collagePath(c.collageId) : null),
  requests: (c) => (c.requestId ? requestPath(c.requestId) : null),
  contributions: (c) =>
    c.contributionId && c.contribution?.release?.communityId
      ? releasePath(
          c.contribution.release.communityId,
          c.contribution.releaseId
        )
      : null,
  communities: (c) => (c.communityId ? communityPath(c.communityId) : null)
};

/** The release whose page a comment links to, if it links to one. */
const releaseOfComment = (c: CommentRow): number | null =>
  c.page === 'release'
    ? c.releaseId
    : c.page === 'contributions'
      ? (c.contribution?.releaseId ?? null)
      : null;

// A comment is visible exactly when its thread is (#697), so a reporter gets
// the link only when canSeeThreadOf lets them read that thread. Staff get it
// when the page it links to will open for them.
const resolveComments: Resolver = async (entries, viewer) => {
  const comments = await prisma.comment.findMany({
    where: { id: { in: idsOf(entries) } },
    select: commentSelect
  });
  const visible = new Map<number, CommentRow>();
  const reporter = reporterOf(viewer);
  if (reporter) {
    for (const c of comments) {
      if (await canSeeThreadOf(c, reporter.id)) visible.set(c.id, c);
    }
  } else {
    const releaseIds = comments
      .map(releaseOfComment)
      .filter((id): id is number => id !== null);
    const openable = await openableReleases(releaseIds, viewer);
    for (const c of comments) {
      const releaseId = releaseOfComment(c);
      if (releaseId === null || openable.has(releaseId)) visible.set(c.id, c);
    }
  }
  return byTarget(entries, visible, (c) => COMMENT_URLS[c.page](c));
};

/**
 * One resolver per target type. A `Record`, so a new target type fails to
 * compile until someone decides what its link is and who may see it.
 */
const RESOLVERS: Record<ReportTargetType, Resolver> = {
  User: resolveUsers,
  Release: resolveReleases,
  Contribution: resolveContributions,
  ForumTopic: resolveTopics,
  ForumPost: resolvePosts,
  Comment: resolveComments,
  Artist: fromId(artistPath),
  Collage: fromId(collagePath),
  Post: async (entries) => entries.map(({ reportId }) => [reportId, null])
};

/** Each report's `sourceUrl`, keyed by report id, one query per target type. */
export async function resolveSourceUrls(
  items: Array<{ id: number; targetType: ReportTargetType; targetId: number }>,
  viewer: Viewer
): Promise<Map<number, string | null>> {
  const byType = new Map<ReportTargetType, Entry[]>();
  for (const r of items) {
    const entries = byType.get(r.targetType) ?? [];
    entries.push({ reportId: r.id, targetId: r.targetId });
    byType.set(r.targetType, entries);
  }

  const urlMap = new Map<number, string | null>();
  for (const [type, entries] of byType) {
    for (const [reportId, url] of await RESOLVERS[type](entries, viewer)) {
      urlMap.set(reportId, url);
    }
  }
  return urlMap;
}
