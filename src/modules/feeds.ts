/**
 * The Member Feed (ADR-0014, #262): four RSS feeds a member reads from a feed
 * reader, and the RSS rendering they share with the Release-Announce push.
 *
 * Every function here takes the feed's OWNER, never a request. A feed has no
 * session, so there is no `req.user` to read; the owner was authenticated by
 * the feed token (`modules/feedToken.ts`) before any of this runs.
 *
 * Three rules hold across the catalog, and each is a reason not to "simplify":
 *
 *  - Every contribution feed reads through `contributionVisibleTo(owner)`. A feed
 *    shows its owner exactly what the release pages would, private communities
 *    included, and nothing more (ADR-0036 §2).
 *  - Items notify and link (#136). The link is the release page; no item ever
 *    carries a download or tokenized URL.
 *  - Nothing is cached in-process. Every read is per owner and `tag` is free
 *    text, so a cache key would be caller-chosen, and `TtlCache` is unbounded
 *    (#662). The route sends `Cache-Control` instead.
 */
import type { Bitrate, FileType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { email, site } from './config';
import { contributionVisibleTo } from './communityAccess';
import { resolveTagName } from './tag';
import { renderSiteBBCode, resolveViewerForUser } from './bbcodeRender';
import {
  contributionItemTitle,
  releaseUrl,
  renderRssChannel,
  type RssChannel,
  type RssItem
} from '../lib/rss';

/** Items per feed. Feed readers poll; they do not page. */
export const FEED_SIZE = 50;

// ─── The catalog ──────────────────────────────────────────────────────────────

export interface ContributionFeedFilters {
  community?: number;
  tag?: string;
  format?: FileType;
  bitrate?: Bitrate;
}

const contributionItemSelect = {
  id: true,
  releaseId: true,
  type: true,
  createdAt: true,
  user: { select: { username: true } },
  release: {
    select: { title: true, community: { select: { name: true } } }
  },
  collaborators: { select: { name: true } }
} satisfies Prisma.ContributionSelect;

type ContributionRow = Prisma.ContributionGetPayload<{
  select: typeof contributionItemSelect;
}>;

const toContributionItem = (c: ContributionRow): RssItem => ({
  title: contributionItemTitle(
    c.collaborators.map((a) => a.name),
    c.release.title,
    c.type
  ),
  link: releaseUrl(c.releaseId),
  guid: `stellar-contribution-${c.id}`,
  pubDate: c.createdAt,
  category: c.release.community?.name ?? null,
  creator: c.user.username
});

/** Newest first, within what the owner may see. `release` is ANDed with access. */
const readContributions = async (
  ownerId: number,
  release: Prisma.ReleaseWhereInput[],
  where: Prisma.ContributionWhereInput = {}
): Promise<RssItem[]> => {
  const rows = await prisma.contribution.findMany({
    where: {
      ...where,
      AND: [contributionVisibleTo(ownerId), { release: { AND: release } }]
    },
    orderBy: { id: 'desc' },
    take: FEED_SIZE,
    select: contributionItemSelect
  });
  return rows.map(toContributionItem);
};

const channel = (name: string, description: string): RssChannel => ({
  title: `${site.name} — ${name}`,
  link: email.siteUrl,
  description
});

/**
 * New contributions. Filters AND together. A `community` the owner cannot see
 * yields an empty feed, never an error, so a feed URL cannot probe for one.
 */
export const renderContributionsFeed = async (
  ownerId: number,
  { community, tag, format, bitrate }: ContributionFeedFilters
): Promise<string> => {
  const release: Prisma.ReleaseWhereInput[] = [];
  if (community !== undefined) release.push({ communityId: community });
  if (tag !== undefined) {
    const name = await resolveTagName(tag);
    release.push({ releaseTags: { some: { tag: { name } } } });
  }
  const items = await readContributions(ownerId, release, {
    ...(format !== undefined && { type: format }),
    ...(bitrate !== undefined && { releaseFile: { bitrate } })
  });
  return renderRssChannel(
    channel('New contributions', `New contributions on ${site.name}`),
    items
  );
};

/** The owner's own contributions — still access-filtered, like every surface. */
export const renderMineFeed = async (ownerId: number): Promise<string> =>
  renderRssChannel(
    channel('My contributions', `Your contributions on ${site.name}`),
    await readContributions(ownerId, [], { userId: ownerId })
  );

/**
 * New contributions on bookmarked releases, and on releases crediting a
 * bookmarked artist in any role. One row per contribution, so a release that
 * matches both ways appears once.
 */
export const renderBookmarksFeed = async (ownerId: number): Promise<string> =>
  renderRssChannel(
    channel('Bookmarks', `New contributions on your bookmarks on ${site.name}`),
    await readContributions(ownerId, [
      {
        OR: [
          { bookmarks: { some: { userId: ownerId } } },
          {
            credits: {
              some: { artist: { bookmarks: { some: { userId: ownerId } } } }
            }
          }
        ]
      }
    ])
  );

/**
 * Site news, the body rendered for the owner as viewer, so `[mature]` follows
 * their setting. Links to the homepage item anchor (stellar-ui#348).
 */
export const renderNewsFeed = async (ownerId: number): Promise<string> => {
  const [rows, viewer] = await Promise.all([
    prisma.news.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: FEED_SIZE
    }),
    resolveViewerForUser(ownerId)
  ]);
  const items = await Promise.all(
    rows.map(async (n): Promise<RssItem> => ({
      title: n.title,
      link: `${email.siteUrl}/#news-${n.id}`,
      guid: `stellar-news-${n.id}`,
      pubDate: n.createdAt,
      description: await renderSiteBBCode(n.body, viewer)
    }))
  );
  return renderRssChannel(channel('News', `Site news on ${site.name}`), items);
};
