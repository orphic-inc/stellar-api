/**
 * Drift-guard for the built-in wiki fixtures (#126).
 *
 * The load-bearing test is `every internal /wiki/... token has a fixture`. That
 * is the bug this whole slice exists to fix: `${invite_article}` and friends
 * resolved to `/wiki/...` routes for the canon to link, and nothing ever created
 * the pages — so every install shipped a canon with dead links. A token added
 * later without a fixture would silently reintroduce it, and no other test in
 * the suite would notice.
 *
 * Pure (no DB): `resolveSiteVariables` takes its client as a parameter, so a stub
 * covering the one lookup it makes is enough.
 */
import { PrismaClient } from '@prisma/client';
import { existsSync } from 'fs';
import { resolve } from 'path';
import {
  BUILTIN_WIKI_FIXTURES,
  WIKI_USER_PAGE_ID_FLOOR,
  readWikiFixtureBody,
  seedWikiFixtures
} from './wikiFixtures';
import { resolveSiteVariables } from './siteVariables';

// resolveSiteVariables only touches forum.findFirst (the Bugs forum lookup).
const stubClient = {
  forum: { findFirst: async () => ({ id: 1 }) }
} as unknown as PrismaClient;

describe('built-in wiki fixtures', () => {
  const slugs = BUILTIN_WIKI_FIXTURES.map((f) => f.slug);

  it('has a fixture for every internal /wiki/... site variable', async () => {
    const vars = await resolveSiteVariables(stubClient);

    const linked = Object.entries(vars)
      .filter(([, value]) => value.startsWith('/wiki/'))
      .map(([token, value]) => ({ token, slug: value.slice('/wiki/'.length) }));

    // Guards the assumption itself — if the tokens are renamed away from
    // /wiki/..., this test would vacuously pass while the canon rots.
    expect(linked.length).toBeGreaterThanOrEqual(11);

    const missing = linked.filter((l) => !slugs.includes(l.slug));
    expect(missing).toEqual([]);
  });

  it('ships a non-empty markdown body for every fixture', () => {
    for (const fixture of BUILTIN_WIKI_FIXTURES) {
      const path = resolve(
        __dirname,
        '../../prisma/seed-wiki',
        `${fixture.slug}.md`
      );
      expect(existsSync(path)).toBe(true);
      expect(readWikiFixtureBody(fixture.slug).trim().length).toBeGreaterThan(
        0
      );
    }
  });

  it('keeps no ${...} tokens in fixture bodies', () => {
    // Wiki bodies are served verbatim — only GET /api/rules/tree substitutes
    // (ADR-0020). A token here would render literally to the member.
    for (const fixture of BUILTIN_WIKI_FIXTURES) {
      expect(readWikiFixtureBody(fixture.slug)).not.toMatch(/\$\{[a-z_]+\}/);
    }
  });

  it('fits the WikiPage column limits and uses unique slugs', () => {
    for (const fixture of BUILTIN_WIKI_FIXTURES) {
      expect(fixture.slug.length).toBeLessThanOrEqual(50);
      expect(fixture.title.length).toBeLessThanOrEqual(100);
    }
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('pins deterministic ids: unique, contiguous from 1, below the floor (#399)', () => {
    const ids = BUILTIN_WIKI_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(ids.map((_, i) => i + 1)); // 1..N in order
    expect(Math.max(...ids)).toBeLessThan(WIKI_USER_PAGE_ID_FLOOR);
  });
});

describe('seedWikiFixtures', () => {
  it('creates pages with their pinned ids and reserves the id block (#399)', async () => {
    const create = jest.fn(async () => ({}));
    const queryRawUnsafe = jest.fn(async (_sql: string) => 1);
    const client = {
      wikiPage: { findUnique: async () => null, create },
      $queryRawUnsafe: queryRawUnsafe
    } as unknown as PrismaClient;

    await seedWikiFixtures(client, 42);

    // Every fresh fixture is created with its explicit id (not autoincrement).
    expect(create).toHaveBeenCalledTimes(BUILTIN_WIKI_FIXTURES.length);
    for (const fixture of BUILTIN_WIKI_FIXTURES) {
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: fixture.id, slug: fixture.slug })
      });
    }

    // The sequence is advanced once so member pages don't reuse a fixture id.
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    const sql = queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('setval');
    expect(sql).toContain('wiki_pages');
    expect(sql).toContain(String(WIKI_USER_PAGE_ID_FLOOR - 1));
  });

  it('skips fixtures that already exist but still reserves the block', async () => {
    const create = jest.fn(async () => ({}));
    const queryRawUnsafe = jest.fn(async (_sql: string) => 1);
    const client = {
      wikiPage: { findUnique: async () => ({ id: 1 }), create },
      $queryRawUnsafe: queryRawUnsafe
    } as unknown as PrismaClient;

    await seedWikiFixtures(client, 42);

    expect(create).not.toHaveBeenCalled();
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
