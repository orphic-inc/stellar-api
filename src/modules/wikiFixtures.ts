/**
 * Built-in wiki fixtures — the in-app pages the site ships with (#126).
 *
 * Two kinds of page live here, and the reason they share a seeder is that both
 * must exist for the Golden Rules to make sense:
 *
 *   - the sub-ruleset pages (`forum-rules`, `staff-rules`) the canon points at;
 *   - the feature explainers the canon cites by name — `${invite_article}`,
 *     `${classes_article}`, `${requests_article}`, `${interfaces_article}`;
 *   - the policy guidance behind rules 5 and 6 — `vpns`, `ips`, `autosnatch`,
 *     `security-disclosure`, `exploits` (#215).
 *
 * That second group is why this is a fix and not just a feature: those four
 * tokens have always resolved to `/wiki/...` routes, and nothing ever created
 * the pages. Every install shipped a canon with dead links in it.
 *
 * The third group reached the same place by a different route: it was filed as
 * public-KB content, but every behaviour it governs requires an account, so by
 * the earliest-needed-audience test it is member-only like the rest of these.
 *
 * Prose lives on disk as real markdown under `prisma/seed-wiki/` (shipped in the
 * image — the Dockerfile copies `prisma/`), mirroring how `stylesheetFixtures`
 * keeps CSS as real `.css`. It reviews as prose in a diff instead of as an
 * escaped string literal.
 *
 * NOTE: wiki bodies are served verbatim. `${...}` substitution happens only for
 * `GET /api/rules/tree` (ADR-0020), so a token written into one of these pages
 * would render literally to the member. Keep the prose site-neutral and link
 * with plain `/wiki/...` paths.
 *
 * Pages are owned by the reserved System user, like the stylesheet fixtures.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface WikiFixture {
  /** URL slug — also the filename stem under prisma/seed-wiki/. Max 50 chars. */
  slug: string;
  /** Display title. Max 100 chars. */
  title: string;
  /**
   * Whether a Golden Rule links to this page. Guards the drift spec: the canon
   * must not cite a page this seeder does not create.
   */
  citedByCanon: boolean;
}

export const BUILTIN_WIKI_FIXTURES: readonly WikiFixture[] = [
  { slug: 'forum-rules', title: 'Forum Rules', citedByCanon: true },
  { slug: 'staff-rules', title: 'Staff Rules', citedByCanon: true },
  { slug: 'invite', title: 'Invites', citedByCanon: true },
  { slug: 'classes', title: 'User Classes', citedByCanon: true },
  { slug: 'requests', title: 'Requests', citedByCanon: true },
  { slug: 'interfaces', title: 'Interface Whitelist', citedByCanon: true },
  { slug: 'vpns', title: 'Proxies and VPNs', citedByCanon: true },
  { slug: 'ips', title: 'Static and Shared IP Addresses', citedByCanon: true },
  { slug: 'autosnatch', title: 'Automated Snatching', citedByCanon: true },
  {
    slug: 'security-disclosure',
    title: 'Reporting a Security Vulnerability',
    citedByCanon: true
  },
  { slug: 'exploits', title: 'Exploits', citedByCanon: true }
];

/** Read a fixture's markdown body off disk. Exported so the drift spec reads the same bytes. */
export function readWikiFixtureBody(slug: string): string {
  return readFileSync(
    resolve(__dirname, '../../prisma/seed-wiki', `${slug}.md`),
    'utf8'
  );
}

/**
 * Seed the built-in wiki pages, owned by the System user.
 *
 * Create-if-absent per slug rather than a table-wide guard: these pages are
 * editable in-app once seeded, so re-running must not clobber an operator's
 * edits — but a NEW fixture added in a later release still lands on an existing
 * install. (The table-wide shape is the trap #388 records against
 * `seedGoldenRules`, where one existing row suppresses the whole set.)
 */
export async function seedWikiFixtures(
  client: PrismaClient,
  systemUserId: number
): Promise<void> {
  for (const fixture of BUILTIN_WIKI_FIXTURES) {
    const existing = await client.wikiPage.findUnique({
      where: { slug: fixture.slug },
      select: { id: true }
    });
    if (existing) continue;

    await client.wikiPage.create({
      data: {
        slug: fixture.slug,
        title: fixture.title,
        body: readWikiFixtureBody(fixture.slug),
        authorId: systemUserId
      }
    });
  }
}
