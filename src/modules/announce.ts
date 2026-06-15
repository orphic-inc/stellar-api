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
  community: string | null;
  type: string;
  createdAt: Date;
  link: string;
}

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
        select: { title: true, community: { select: { name: true } } }
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

  try {
    const res = await fetch(`${apiUrl}/irc/announce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pull-key': pullKey },
      body: JSON.stringify({
        xmlPayload: renderAnnounceRss([item]),
        templateType: 'minimal',
        environment: { osc8: false }
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
