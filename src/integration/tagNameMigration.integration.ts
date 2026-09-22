/**
 * Integration coverage for the tag name migration (#689, ADR-0047).
 *
 * Two claims, both about the database. First, that the SQL expression the
 * migration normalizes with agrees with `normalizeTagName` — the migration
 * restates the rule, and this is what stops the two drifting. Second, that the
 * migration's merge does what ADR-0047 says: which variant survives, what a
 * release carrying two variants keeps, how `occurrences` is recounted, and what
 * becomes of each kind of alias.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReleaseType } from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { normalizeTagName } from '../modules/tag';

const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260922120000_normalize_tag_names/migration.sql'
  ),
  'utf8'
);

/** The migration's own copy of the rule, cut out between its markers. */
const normalizeExpression = (): string => {
  const parts = MIGRATION_SQL.split(/\/\* normalize:(?:begin|end) \*\//);
  // Exactly one marked region: a second would mean two copies to keep in step.
  expect(parts).toHaveLength(3);
  return parts[1];
};

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('the migration normalizes exactly as normalizeTagName does', () => {
  // Chosen to hit every branch of the rule and each place SQL and JavaScript
  // could part ways: Unicode case mappings that land in ASCII, whitespace the
  // two engines might classify differently, and the separator runs.
  const fixtures = [
    'Rock',
    'ROCK',
    '  Shoegaze ',
    'Hip Hop',
    'hip-hop',
    'hip_hop',
    'hip.hop',
    'hip  -  hop',
    'hip..hop',
    'Drum & Bass',
    '.rock.',
    '-rock-',
    '__a__b__',
    '1980s',
    'AbC123',
    'a\tb',
    'a\nb',
    'a\rb',
    'a\fb',
    'a\vb',
    'a\u00a0b',
    '\u212a',
    '\u0130stanbul',
    '\u00c9cole',
    '\u266b',
    '\ud83c\udfb8 guitar',
    '&&&',
    '...',
    '',
    'seed.jazz'
  ];

  it('agrees on every fixture', async () => {
    const rows = await testPrisma.$queryRawUnsafe<
      Array<{ raw: string; norm: string }>
    >(
      `SELECT raw, ${normalizeExpression()} AS norm
         FROM unnest($1::text[]) WITH ORDINALITY AS u(raw, i)
        ORDER BY i`,
      fixtures
    );
    expect(rows.map((r) => [r.raw, r.norm])).toEqual(
      fixtures.map((raw) => [raw, normalizeTagName(raw)])
    );
  });
});

describe('the migration merges variants', () => {
  const run = () => testPrisma.$executeRawUnsafe(MIGRATION_SQL);

  let seq = 0;
  const mkUser = async () => {
    const n = (seq += 1);
    const rank = await testPrisma.userRank.findFirstOrThrow();
    const settings = await testPrisma.userSettings.create({ data: {} });
    const profile = await testPrisma.profile.create({ data: {} });
    return testPrisma.user.create({
      data: {
        username: `it-tagnorm-${n}`,
        email: `it-tagnorm-${n}@example.com`,
        password: 'x',
        avatar: '',
        userRankId: rank.id,
        userSettingsId: settings.id,
        profileId: profile.id
      }
    });
  };
  const mkTag = (name: string, extra: { isOfficial?: boolean } = {}) =>
    testPrisma.tag.create({ data: { name, occurrences: 0, ...extra } });
  const mkRelease = (title: string) =>
    testPrisma.release.create({
      data: {
        title,
        description: 'desc',
        type: ReleaseType.Music,
        releaseType: 'Album',
        year: 2020
      }
    });
  const tagIdsOf = async (releaseId: number) =>
    (
      await testPrisma.releaseTag.findMany({
        where: { releaseId },
        select: { tagId: true }
      })
    ).map((rt) => rt.tagId);

  it('keeps the row already named canonically, and carries curation to it', async () => {
    const canonical = await mkTag('hip.hop');
    const official = await mkTag('Hip Hop', { isOfficial: true });
    const plain = await mkTag('hip-hop');

    await run();

    const left = await testPrisma.tag.findMany({
      where: { id: { in: [canonical.id, official.id, plain.id] } }
    });
    expect(left).toEqual([
      expect.objectContaining({
        id: canonical.id,
        name: 'hip.hop',
        isOfficial: true
      })
    ]);
  });

  it('otherwise keeps the official row, renamed', async () => {
    const plain = await mkTag('Rock');
    const official = await mkTag('ROCK', { isOfficial: true });

    await run();

    expect(await testPrisma.tag.findUnique({ where: { id: plain.id } })).toBe(
      null
    );
    expect(
      await testPrisma.tag.findUnique({ where: { id: official.id } })
    ).toEqual(expect.objectContaining({ name: 'rock', isOfficial: true }));
  });

  it('otherwise keeps the lowest id', async () => {
    const first = await mkTag('Free Jazz');
    await mkTag('FREE-JAZZ');

    await run();

    expect(await testPrisma.tag.findMany({ select: { id: true } })).toEqual([
      { id: first.id }
    ]);
  });

  it('renames a lone variant without touching its count', async () => {
    const lone = await testPrisma.tag.create({
      data: { name: 'Free Jazz', occurrences: 5 }
    });

    await run();

    expect(await testPrisma.tag.findUnique({ where: { id: lone.id } })).toEqual(
      expect.objectContaining({ name: 'free.jazz', occurrences: 5 })
    );
  });

  it('leaves a tag with no usable characters alone', async () => {
    const junk = await mkTag('\u266b');

    await run();

    expect(await testPrisma.tag.findUnique({ where: { id: junk.id } })).toEqual(
      expect.objectContaining({ name: '\u266b' })
    );
  });

  it('keeps one tag per release, on the best-ranked variant, and drops the loser with its votes', async () => {
    const user = await mkUser();
    const canonical = await mkTag('hip.hop');
    const official = await mkTag('Hip Hop', { isOfficial: true });
    const plain = await mkTag('hip-hop');

    // Carries the survivor and a variant: the survivor's row stays.
    const both = await mkRelease('both');
    const kept = await testPrisma.releaseTag.create({
      data: { releaseId: both.id, tagId: canonical.id }
    });
    const dropped = await testPrisma.releaseTag.create({
      data: { releaseId: both.id, tagId: official.id }
    });
    await testPrisma.releaseTagVote.create({
      data: { releaseTagId: dropped.id, userId: user.id, direction: 'up' }
    });

    // Carries two variants but not the survivor: the better-ranked one stays.
    const variants = await mkRelease('variants');
    const promoted = await testPrisma.releaseTag.create({
      data: { releaseId: variants.id, tagId: official.id }
    });
    await testPrisma.releaseTag.create({
      data: { releaseId: variants.id, tagId: plain.id }
    });

    await run();

    expect(await tagIdsOf(both.id)).toEqual([canonical.id]);
    expect(
      await testPrisma.releaseTag.findUnique({ where: { id: kept.id } })
    ).not.toBeNull();
    expect(
      await testPrisma.releaseTagVote.count({
        where: { releaseTagId: dropped.id }
      })
    ).toBe(0);

    expect(
      await testPrisma.releaseTag.findMany({
        where: { releaseId: variants.id },
        select: { id: true, tagId: true }
      })
    ).toEqual([{ id: promoted.id, tagId: canonical.id }]);
  });

  it('recounts a merged tag from its releases rather than summing', async () => {
    // Each count is right for its own variant: `rock` is on r1, `Rock` on r1
    // and r2. The sum says 3, the truth is 2, and the survivor's own count of 1
    // is wrong too — so a skipped recount fails this as surely as a sum does.
    const a = await testPrisma.tag.create({
      data: { name: 'rock', occurrences: 1 }
    });
    const b = await testPrisma.tag.create({
      data: { name: 'Rock', occurrences: 2 }
    });
    const r1 = await mkRelease('r1');
    const r2 = await mkRelease('r2');
    await testPrisma.releaseTag.createMany({
      data: [
        { releaseId: r1.id, tagId: a.id },
        { releaseId: r1.id, tagId: b.id },
        { releaseId: r2.id, tagId: b.id }
      ]
    });

    await run();

    expect(await testPrisma.tag.findUnique({ where: { id: a.id } })).toEqual(
      expect.objectContaining({ occurrences: 2 })
    );
  });

  it('keeps one tag per artist, on the best-ranked variant', async () => {
    const plain = await mkTag('Rock');
    const official = await mkTag('ROCK', { isOfficial: true });
    const artist = await testPrisma.artist.create({ data: { name: 'Band' } });
    await testPrisma.artistTag.createMany({
      data: [
        { artistId: artist.id, tagId: plain.id },
        { artistId: artist.id, tagId: official.id }
      ]
    });

    await run();

    expect(
      await testPrisma.artistTag.findMany({
        where: { artistId: artist.id },
        select: { tagId: true }
      })
    ).toEqual([{ tagId: official.id }]);
  });

  describe('aliases', () => {
    const alias = async (badTag: string, goodTagId: number) =>
      testPrisma.tagAlias.create({
        data: { badTag, goodTagId, createdById: (await mkUser()).id }
      });
    const aliases = () =>
      testPrisma.tagAlias.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, badTag: true, goodTagId: true }
      });

    it('normalizes badTag and follows a merged-away target to its survivor', async () => {
      const survivor = await mkTag('metal');
      const variant = await mkTag('Metal');
      const a = await alias('Heavy Metal!', variant.id);

      await run();

      expect(await aliases()).toEqual([
        { id: a.id, badTag: 'heavy.metal', goodTagId: survivor.id }
      ]);
    });

    it('drops an alias with no usable characters', async () => {
      const target = await mkTag('metal');
      await alias('&&&', target.id);

      await run();

      expect(await aliases()).toEqual([]);
    });

    it('drops an alias that normalizes onto its own target', async () => {
      const target = await mkTag('hip.hop');
      await alias('Hip-Hop', target.id);

      await run();

      expect(await aliases()).toEqual([]);
    });

    it('drops an alias that would alias away an official tag', async () => {
      await mkTag('rock', { isOfficial: true });
      const other = await mkTag('metal');
      await alias('ROCK!', other.id);

      await run();

      expect(await aliases()).toEqual([]);
    });

    it('keeps the older of two aliases that normalize alike', async () => {
      const first = await mkTag('jazz');
      const second = await mkTag('blues');
      const older = await alias('Rock Music', first.id);
      await alias('rock_music', second.id);

      await run();

      expect(await aliases()).toEqual([
        { id: older.id, badTag: 'rock.music', goodTagId: first.id }
      ]);
    });
  });

  it('changes nothing already canonical, so it is safe to run again', async () => {
    const tag = await testPrisma.tag.create({
      data: { name: 'hip.hop', occurrences: 3, isOfficial: true }
    });
    await testPrisma.tagAlias.create({
      data: {
        badTag: 'hiphop',
        goodTagId: tag.id,
        createdById: (await mkUser()).id
      }
    });

    await run();
    await run();

    expect(await testPrisma.tag.findMany()).toEqual([tag]);
    expect(
      await testPrisma.tagAlias.findMany({ select: { badTag: true } })
    ).toEqual([{ badTag: 'hiphop' }]);
  });
});
