import {
  makeUsername,
  makeSeedEmail,
  makeArtistName,
  makeAlbumTitle,
  makeTagSet,
  makeBBCodeProfile,
  makeBBCodeWikiPage,
  makeBBCodeForumPost,
  makeReleaseDescription,
  makeCommunityName,
  makeWikiSlug,
  GENRE_TAGS,
  ERA_TAGS,
  DESCRIPTOR_TAGS
} from './contentFactory';
import { SeedContext } from './seedRandom';
import { normalizeTagName } from '../tag';

jest.mock('../../lib/prisma', () => ({ prisma: {} }));

describe('makeUsername', () => {
  it('returns a non-empty string', () => {
    const ctx = new SeedContext(1);
    const name = makeUsername(0, ctx);
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });

  it('uses the index to ensure uniqueness', () => {
    const ctx1 = new SeedContext(1);
    const ctx2 = new SeedContext(1);
    const name0 = makeUsername(0, ctx1);
    const name1 = makeUsername(999, ctx2);
    expect(name0).not.toBe(name1);
  });
});

describe('makeSeedEmail', () => {
  it('always uses @seed.invalid domain', () => {
    expect(makeSeedEmail('seed_aurora_bay0')).toBe(
      'seed_aurora_bay0@seed.invalid'
    );
  });

  it('appends @seed.invalid to any username', () => {
    expect(makeSeedEmail('foo')).toMatch(/@seed\.invalid$/);
  });
});

describe('makeArtistName', () => {
  it('returns a non-empty string', () => {
    const ctx = new SeedContext(42);
    for (let i = 0; i < 20; i++) {
      const name = makeArtistName(ctx);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    const ctx1 = new SeedContext(77);
    const ctx2 = new SeedContext(77);
    expect(makeArtistName(ctx1)).toBe(makeArtistName(ctx2));
  });
});

describe('makeAlbumTitle', () => {
  it('returns a non-empty string', () => {
    const ctx = new SeedContext(5);
    for (let i = 0; i < 20; i++) {
      const title = makeAlbumTitle(ctx);
      expect(title.length).toBeGreaterThan(0);
    }
  });
});

describe('makeTagSet', () => {
  it('in isolated mode, all tags start with seed.', () => {
    const ctx = new SeedContext(3);
    for (let i = 0; i < 20; i++) {
      const tags = makeTagSet(ctx, true);
      tags.forEach((t) => expect(t).toMatch(/^seed\./));
    }
  });

  it('in integrated mode, tags do NOT start with seed.', () => {
    const ctx = new SeedContext(3);
    for (let i = 0; i < 20; i++) {
      const tags = makeTagSet(ctx, false);
      tags.forEach((t) => expect(t).not.toMatch(/^seed\./));
    }
  });

  it('returns 1–6 tags', () => {
    const ctx = new SeedContext(8);
    for (let i = 0; i < 50; i++) {
      const tags = makeTagSet(ctx, true);
      expect(tags.length).toBeGreaterThanOrEqual(1);
      expect(tags.length).toBeLessThanOrEqual(6);
    }
  });

  it('draws only names already in canonical form (#689)', () => {
    // The generator normalizes before minting anyway; this keeps the pools
    // honest, so a seeded name never differs from the one a member would type.
    for (const t of [...GENRE_TAGS, ...ERA_TAGS, ...DESCRIPTOR_TAGS]) {
      expect(normalizeTagName(t)).toBe(t);
    }
  });

  it('has no duplicate tags within a set', () => {
    const ctx = new SeedContext(100);
    for (let i = 0; i < 50; i++) {
      const tags = makeTagSet(ctx, true);
      expect(new Set(tags).size).toBe(tags.length);
    }
  });
});

describe('makeBBCodeProfile', () => {
  it('returns non-empty string', () => {
    const ctx = new SeedContext(1);
    expect(makeBBCodeProfile(ctx).length).toBeGreaterThan(0);
  });
});

describe('makeBBCodeWikiPage', () => {
  it('returns a multi-line string with BBCode patterns', () => {
    const ctx = new SeedContext(9);
    const page = makeBBCodeWikiPage(ctx);
    expect(page).toContain('[b]');
    expect(page.split('\n').length).toBeGreaterThan(3);
  });

  it('is deterministic', () => {
    const ctx1 = new SeedContext(22);
    const ctx2 = new SeedContext(22);
    expect(makeBBCodeWikiPage(ctx1)).toBe(makeBBCodeWikiPage(ctx2));
  });
});

describe('makeBBCodeForumPost', () => {
  it('returns non-empty string', () => {
    const ctx = new SeedContext(4);
    expect(makeBBCodeForumPost(ctx).length).toBeGreaterThan(0);
  });

  it('sometimes includes quote when username is provided', () => {
    // Run many times to hit the quote branch
    let hasQuote = false;
    const ctx = new SeedContext(7);
    for (let i = 0; i < 50; i++) {
      const post = makeBBCodeForumPost(
        ctx,
        'testuser',
        'some previous post body'
      );
      if (post.includes('[quote=')) hasQuote = true;
    }
    expect(hasQuote).toBe(true);
  });
});

describe('makeReleaseDescription', () => {
  it('returns a non-empty string', () => {
    const ctx = new SeedContext(6);
    expect(makeReleaseDescription(ctx).length).toBeGreaterThan(0);
  });
});

describe('makeCommunityName', () => {
  it('is unique per index', () => {
    const ctx1 = new SeedContext(1);
    const ctx2 = new SeedContext(1);
    const n1 = makeCommunityName(1, ctx1);
    const n2 = makeCommunityName(2, ctx2);
    expect(n1).not.toBe(n2);
  });
});

describe('makeWikiSlug', () => {
  it('returns lowercase, hyphenated slug', () => {
    const slug = makeWikiSlug('Log Files and Cue Sheets Guide 1');
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug).not.toContain(' ');
  });

  it('truncates to 50 chars', () => {
    const slug = makeWikiSlug('A'.repeat(200) + ' Title');
    expect(slug.length).toBeLessThanOrEqual(50);
  });
});
