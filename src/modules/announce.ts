/**
 * Release-Announce publisher (ADR-0013) — stellar PUSHES new-contribution RSS to
 * korin.pink, which renders it into the IRC `#announce` channel.
 *
 * Direction reversal vs the superseded in-repo build (#140, AnnounceKey-gated
 * RSS *feed*): under korin.pink, stellar owns the release data and emits it;
 * korin owns the IRC surface and renders it. stellar POSTs each new item to
 * korin's `POST /irc/announce` (templateType `minimal`). Notify-and-link (#136):
 * the item link points at the release page, never a tokenized download URL.
 */
import type { AnnounceVisibility } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { korin, email } from './config';
import { getLogger } from './logging';

const log = getLogger('announce');

export interface AnnounceItem {
  /** Contribution id — also the feed cursor. */
  id: number;
  releaseId: number;
  title: string;
  artists: string[];
  /** Community name — the RSS `<category>`; display only. */
  community: string | null;
  /**
   * Numeric `Community.id`, the identifier the routing target is keyed by.
   * korin derives `#c-<id>` from it, so it is stable across renames — never a
   * name or slug (ADR-0030 Decision 3/4). Null for a contribution with no
   * community, which routes to the public firehose.
   */
  communityId: number | null;
  /**
   * The community's announce routing flag. **Routing only — never an access
   * input** (ADR-0030 Decision 1, ADR-0015, Golden Rule 3). It decides which
   * IRC channel sees the line, never who may download.
   */
  announceVisibility: AnnounceVisibility | null;
  type: string;
  createdAt: Date;
  link: string;
}

/**
 * Optional routing target on the announce push (ADR-0030 Decision 3).
 *
 * The wire field stays `visibility` even though the stellar column is
 * `announceVisibility` — only the column was renamed, and renaming it here
 * would break the pinned contract.
 */
export interface AnnounceTarget {
  visibility: AnnounceVisibility;
  /** Numeric Community.id; korin derives the channel from it. */
  community: number;
  /**
   * Forward-compat slot for a future admin-bound channel. Sent empty: korin
   * derives `#c-<id>` today, and stellar has no field to populate it from.
   */
  channel?: string;
}

/**
 * Derive the routing target for an item, or `undefined` for the public path.
 *
 * Omitted and `PUBLIC` are equivalent to korin — both mean the `#announce`
 * firehose — so a contribution with no community, or one in a public community,
 * sends no target at all and the push is byte-identical to the pre-ADR-0030
 * body. That is what makes this extension backward-compatible.
 */
export const announceTarget = (
  item: AnnounceItem
): AnnounceTarget | undefined => {
  if (item.communityId === null || item.announceVisibility !== 'PRIVATE') {
    return undefined;
  }
  return { visibility: 'PRIVATE', community: item.communityId };
};

const releaseUrl = (releaseId: number): string =>
  `${email.siteUrl}/releases/${releaseId}`;

/** New contributions newer than `sinceId`, oldest first (announce in order). */
export const getNewAnnounceItems = async (
  sinceId: number,
  limit = 50
): Promise<AnnounceItem[]> => {
  const contributions = await prisma.contribution.findMany({
    where: { id: { gt: sinceId } },
    orderBy: { id: 'asc' },
    take: limit,
    select: {
      id: true,
      releaseId: true,
      type: true,
      createdAt: true,
      release: {
        select: {
          title: true,
          community: {
            select: { id: true, name: true, announceVisibility: true }
          }
        }
      },
      collaborators: { select: { name: true } }
    }
  });

  return contributions.map((c) => ({
    id: c.id,
    releaseId: c.releaseId,
    title: c.release.title,
    artists: c.collaborators.map((a) => a.name),
    community: c.release.community?.name ?? null,
    communityId: c.release.community?.id ?? null,
    announceVisibility: c.release.community?.announceVisibility ?? null,
    type: c.type,
    createdAt: c.createdAt,
    link: releaseUrl(c.releaseId)
  }));
};

const escapeXml = (s: string): string =>
  s.replace(
    /[<>&'"]/g,
    (ch) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;'
      })[ch] as string
  );

const itemTitle = (item: AnnounceItem): string => {
  const artists = item.artists.length ? `${item.artists.join(', ')} — ` : '';
  return `${artists}${item.title} [${item.type}]`;
};

/** Render items as an RSS 2.0 document (the payload korin parses). */
export const renderAnnounceRss = (items: AnnounceItem[]): string => {
  const entries = items
    .map((item) => {
      const category = item.community
        ? `\n      <category>${escapeXml(item.community)}</category>`
        : '';
      return `    <item>
      <title>${escapeXml(itemTitle(item))}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="false">stellar-contribution-${item.id}</guid>
      <pubDate>${item.createdAt.toUTCString()}</pubDate>${category}
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Stellar — Release Announce</title>
    <link>${escapeXml(email.siteUrl)}</link>
    <description>New contributions on Stellar</description>
${entries}
  </channel>
</rss>`;
};

/**
 * Push a single item to korin's announce renderer. korin's `minimal` template
 * renders the newest artifact in the feed, so one item per POST guarantees each
 * new contribution is announced exactly once. Returns true on a 2xx.
 */
export const publishAnnounceItem = async (
  item: AnnounceItem
): Promise<boolean> => {
  const { apiUrl, pullKey } = korin;
  if (!apiUrl || !pullKey) return false;

  const target = announceTarget(item);

  try {
    const res = await fetch(`${apiUrl}/irc/announce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pull-key': pullKey },
      body: JSON.stringify({
        xmlPayload: renderAnnounceRss([item]),
        templateType: 'minimal',
        environment: { osc8: false },
        // Spread, so a public item sends no `target` key at all rather than an
        // explicit null — omitted is the documented public path.
        ...(target ? { target } : {})
      })
    });
    if (!res.ok) {
      log.warn('korin /irc/announce returned non-2xx', {
        status: res.status,
        contributionId: item.id
      });
      return false;
    }
    return true;
  } catch (err) {
    log.error('Failed to push announce item to korin', {
      err,
      contributionId: item.id
    });
    return false;
  }
};
