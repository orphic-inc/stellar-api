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
  /**
   * Deterministic page id (#399). Pinned so `/wiki/:id` (the route is numeric,
   * not slug) is reproducible across installs and seed cross-links can hard-
   * reference a stable id. Unique, contiguous from 1; must stay below
   * WIKI_USER_PAGE_ID_FLOOR.
   */
  id: number;
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

/**
 * User-created wiki pages start here; ids below it are reserved for fixtures
 * (#399). Leaves headroom (12..999) to add fixtures later without a future id
 * colliding with member content, which begins at 1000.
 */
export const WIKI_USER_PAGE_ID_FLOOR = 1000;

export const BUILTIN_WIKI_FIXTURES: readonly WikiFixture[] = [
  { id: 1, slug: 'forum-rules', title: 'Forum Rules', citedByCanon: true },
  { id: 2, slug: 'staff-rules', title: 'Staff Rules', citedByCanon: true },
  { id: 3, slug: 'invite', title: 'Invites', citedByCanon: true },
  { id: 4, slug: 'classes', title: 'User Classes', citedByCanon: true },
  { id: 5, slug: 'requests', title: 'Requests', citedByCanon: true },
  {
    id: 6,
    slug: 'interfaces',
    title: 'Interface Whitelist',
    citedByCanon: true
  },
  { id: 7, slug: 'vpns', title: 'Proxies and VPNs', citedByCanon: true },
  {
    id: 8,
    slug: 'ips',
    title: 'Static and Shared IP Addresses',
    citedByCanon: true
  },
  {
    id: 9,
    slug: 'autosnatch',
    title: 'Automated Snatching',
    citedByCanon: true
  },
  {
    id: 10,
    slug: 'security-disclosure',
    title: 'Reporting a Security Vulnerability',
    citedByCanon: true
  },
  { id: 11, slug: 'exploits', title: 'Exploits', citedByCanon: true }
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
 *
 * Ids are pinned deterministically (#399). Explicit-id inserts don't advance the
 * autoincrement sequence, so afterwards we push it to WIKI_USER_PAGE_ID_FLOOR
 * (never regressing past the current MAX) — otherwise the next member-created
 * page would reuse a fixture id. Note: create-if-absent means the pin only takes
 * on a fresh row; renumbering an already-populated table needs a reset (a
 * destructive migration, acceptable pre-alpha per #399).
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
        id: fixture.id,
        slug: fixture.slug,
        title: fixture.title,
        body: readWikiFixtureBody(fixture.slug),
        authorId: systemUserId
      }
    });
  }

  // Reserve the fixture id block: advance the sequence to the user-page floor,
  // but never below the current MAX (a busy install may already be past it).
  // $queryRaw (not $executeRaw) because `SELECT setval` returns a row.
  await client.$queryRawUnsafe(
    `SELECT setval(
       pg_get_serial_sequence('wiki_pages', 'id'),
       GREATEST(${
         WIKI_USER_PAGE_ID_FLOOR - 1
       }, COALESCE((SELECT MAX(id) FROM wiki_pages), 0))
     )`
  );
}
