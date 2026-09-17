/**
 * RSS 2.0 rendering, shared by the Release-Announce push (`modules/announce.ts`)
 * and the Member Feed (`modules/feeds.ts`, #262).
 *
 * Pure and dependency-free on purpose. announce.ts runs in a background job and
 * has no use for the BBCode renderer or the access fragments the Member Feed
 * needs; importing the renderer from feeds.ts would drag both into it.
 */
import { email } from '../modules/config';

export const escapeXml = (s: string): string =>
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

export interface RssChannel {
  title: string;
  link: string;
  description: string;
}

export interface RssItem {
  title: string;
  link: string;
  /** Not a permalink: a stable id, so readers de-duplicate across renames. */
  guid: string;
  pubDate: Date;
  category?: string | null;
  /** Rendered as `dc:creator`; declares the Dublin Core namespace when present. */
  creator?: string | null;
  /** HTML, escaped into the element. */
  description?: string | null;
}

const optional = (tag: string, value: string | null | undefined) =>
  value ? `\n      <${tag}>${escapeXml(value)}</${tag}>` : '';

const renderItem = (item: RssItem): string =>
  `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
      <pubDate>${item.pubDate.toUTCString()}</pubDate>${optional('category', item.category)}${optional('dc:creator', item.creator)}${optional('description', item.description)}
    </item>`;

/**
 * An RSS 2.0 document. The Release-Announce push renders through this too, and
 * korin parses those bytes, so the output for an item with no `creator` and no
 * `description` is pinned byte-for-byte in announce.spec.ts.
 */
export const renderRssChannel = (
  channel: RssChannel,
  items: RssItem[]
): string => {
  const dublinCore = items.some((item) => item.creator)
    ? ' xmlns:dc="http://purl.org/dc/elements/1.1/"'
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"${dublinCore}>
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${escapeXml(channel.link)}</link>
    <description>${escapeXml(channel.description)}</description>
${items.map(renderItem).join('\n')}
  </channel>
</rss>`;
};

/** `Artists — Title [type]`, the announce line and the feed item title alike. */
export const contributionItemTitle = (
  artists: string[],
  title: string,
  type: string
): string => {
  const credit = artists.length ? `${artists.join(', ')} — ` : '';
  return `${credit}${title} [${type}]`;
};

export const releaseUrl = (releaseId: number): string =>
  `${email.siteUrl}/releases/${releaseId}`;
