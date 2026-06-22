/**
 * Read-time resolution of the Golden Rules `${...}` tokens (PRD-09 / ADR-0020).
 *
 * The canonical prose (`CODE_OF_CONDUCT.md`) and its seeded mirror store tokens
 * verbatim; this assembles the `variables` map that `GET /api/rules/tree` ships
 * alongside the verbatim tree. The API single-sources the VALUES; the UI does the
 * mechanical substitution and owns presentation (e.g. renders `${irc}` as the nav
 * link, `${vpns_article}` as an anchor to the resolved URL). No value is ever
 * duplicated cross-repo.
 *
 * Token classes:
 *   - text     : `site_name`, `disabled_channel` — substituted in place as-is.
 *   - route/URL: everything else — the UI wraps these in its own link presentation.
 *     Public-guidance articles resolve under the Stellar Public KB (`publicKbBase`);
 *     app-feature references resolve to internal wiki routes; `bugs_forum` resolves
 *     to the seeded Bugs forum (looked up by name — forums are id-based).
 */
import { PrismaClient } from '@prisma/client';
import { site } from './config';

export type SiteVariables = Record<string, string>;

export async function resolveSiteVariables(
  client: PrismaClient
): Promise<SiteVariables> {
  const kb = site.publicKbBase.replace(/\/+$/, '');

  const bugsForum = await client.forum.findFirst({
    where: { name: 'Bugs' },
    select: { id: true }
  });

  return {
    // text tokens
    site_name: site.name,
    disabled_channel: site.disabledChannel,
    // config-backed routes
    irc: site.ircUrl,
    staffpm: site.staffPmPath,
    public_kb: kb,
    // Stellar Public KB articles (public-facing; authored under the KB)
    interview_article: `${kb}/interview`,
    vpns_article: `${kb}/vpns`,
    ips_article: `${kb}/ips`,
    autofp_article: `${kb}/autosnatch`,
    bugs_article: `${kb}/security-disclosure`,
    exploit_article: `${kb}/exploits`,
    // internal app-feature references (existing docs / UI routes)
    invite_article: '/wiki/invite',
    classes_article: '/wiki/classes',
    requests_article: '/wiki/requests',
    interfaces_article: '/wiki/interfaces',
    // the seeded Bugs forum (id-based; resolved by name)
    bugs_forum: bugsForum ? `/forums/${bugsForum.id}` : '/forums'
  };
}
