/**
 * Unit tests for the tag name rule (#689, ADR-0047) and the curated tag
 * vocabulary (#298, ADR-0045).
 */

const mockTag = {
  upsert: jest.fn(),
  update: jest.fn(),
  findMany: jest.fn(),
  findUnique: jest.fn(),
  count: jest.fn()
};
const mockTagAlias = { findUnique: jest.fn(), findMany: jest.fn() };

jest.mock('../lib/prisma', () => ({
  prisma: { tag: mockTag, tagAlias: mockTagAlias }
}));

import {
  normalizeTagName,
  resolveTagName,
  resolveTagNames,
  promoteTag,
  demoteTag,
  listOfficialTags,
  listTags,
  isOfficialTagName
} from './tag';

const row = {
  id: 1,
  name: 'shoegaze',
  occurrences: 0,
  isOfficial: true
};

describe('normalizeTagName', () => {
  it.each([
    ['Rock', 'rock'],
    ['ROCK', 'rock'],
    ['  Shoegaze ', 'shoegaze'],
    ['Hip Hop', 'hip.hop'],
    ['hip-hop', 'hip.hop'],
    ['hip_hop', 'hip.hop'],
    ['hip.hop', 'hip.hop'],
    ['hip  -  hop', 'hip.hop'],
    ['hip..hop', 'hip.hop'],
    ['Drum & Bass', 'drum.bass'],
    ['.rock.', 'rock'],
    ['1980s', '1980s'],
    ['seed.jazz', 'seed.jazz']
  ])('%j becomes %j', (input, expected) => {
    expect(normalizeTagName(input)).toBe(expected);
  });

  it.each(['', '   ', '&&&', '---', '...', '\u266b'])(
    '%j has no usable characters',
    (input) => {
      expect(normalizeTagName(input)).toBe('');
    }
  );

  it('lowercases ASCII only, so a non-ASCII letter never becomes one', () => {
    // A full Unicode lowercase turns the Kelvin sign into `k` and the dotted
    // capital I into `i` plus a combining mark, and Postgres' `lower()` does
    // whatever the database's locale says. The migration has to agree with
    // this function, so both stay inside ASCII (ADR-0047).
    expect(normalizeTagName('\u212a')).toBe('');
    expect(normalizeTagName('\u0130stanbul')).toBe('stanbul');
  });

  it('is idempotent, which the migration relies on to find each group', () => {
    for (const input of ['Hip Hop', 'Drum & Bass', '.a..b.', 'x_Y-z']) {
      const once = normalizeTagName(input);
      expect(normalizeTagName(once)).toBe(once);
    }
  });
});

describe('resolveTagName', () => {
  it('looks the alias up by the NORMALIZED name', async () => {
    mockTagAlias.findUnique.mockResolvedValue(null);
    expect(await resolveTagName('Hip Hop')).toBe('hip.hop');
    expect(mockTagAlias.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { badTag: 'hip.hop' } })
    );
  });

  it('follows the alias after normalizing', async () => {
    mockTagAlias.findUnique.mockResolvedValue({
      goodTag: { name: 'hip.hop' }
    });
    expect(await resolveTagName('HipHop')).toBe('hip.hop');
  });

  it('answers an empty name without querying', async () => {
    expect(await resolveTagName('&&&')).toBe('');
    expect(mockTagAlias.findUnique).not.toHaveBeenCalled();
  });
});

describe('resolveTagNames', () => {
  it('normalizes, drops empties, and dedupes the variants', async () => {
    mockTagAlias.findMany.mockResolvedValue([]);
    expect(
      await resolveTagNames(['Rock', 'rock', '\u266b', 'Hip Hop'])
    ).toEqual(['rock', 'hip.hop']);
    expect(mockTagAlias.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { badTag: { in: ['rock', 'hip.hop'] } }
      })
    );
  });

  it('dedupes after following aliases', async () => {
    mockTagAlias.findMany.mockResolvedValue([
      { badTag: 'hiphop', goodTag: { name: 'hip.hop' } }
    ]);
    expect(await resolveTagNames(['HipHop', 'hip-hop'])).toEqual(['hip.hop']);
  });

  it('answers an all-empty list without querying', async () => {
    expect(await resolveTagNames(['&', ' '])).toEqual([]);
    expect(mockTagAlias.findMany).not.toHaveBeenCalled();
  });
});

describe('promoteTag', () => {
  beforeEach(() => {
    mockTagAlias.findUnique.mockResolvedValue(null);
    mockTag.upsert.mockResolvedValue(row);
  });

  it('mints an absent tag at zero occurrences, not one', () => {
    // A minted tag carries no release yet. Seeding it at 1 would put it in
    // getTopTags' `occurrences > 0` list without anything having used it.
    return promoteTag('shoegaze').then(() => {
      expect(mockTag.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { name: 'shoegaze', occurrences: 0, isOfficial: true }
        })
      );
    });
  });

  it('leaves occurrences alone when the tag already exists', async () => {
    await promoteTag('shoegaze');
    expect(mockTag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { isOfficial: true } })
    );
  });

  it('normalizes the name before it reaches the table', async () => {
    await promoteTag('  Shoe Gaze ');
    expect(mockTag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'shoe.gaze' } })
    );
  });

  it('refuses a name with no usable characters', async () => {
    await expect(promoteTag('&&&')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Tag name has no usable characters'
    });
    expect(mockTag.upsert).not.toHaveBeenCalled();
  });

  it('promotes the good tag when the name is aliased away', async () => {
    // Otherwise curation and normalization contradict each other: the tag would
    // be marked canonical while every write rewrote it to something else.
    mockTagAlias.findUnique.mockResolvedValue({
      goodTag: { name: 'hip.hop' }
    });
    await promoteTag('hiphop');
    expect(mockTag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'hip.hop' } })
    );
  });

  it('resolves the alias on the NORMALIZED name', async () => {
    await promoteTag('HipHop');
    expect(mockTagAlias.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { badTag: 'hiphop' } })
    );
  });
});

describe('demoteTag', () => {
  it('clears the flag without deleting the row', async () => {
    mockTag.update.mockResolvedValue({ ...row, isOfficial: false });
    await demoteTag(1);
    expect(mockTag.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: { isOfficial: false } })
    );
  });
});

describe('listOfficialTags', () => {
  it('reads only official tags, name-sorted, with no take', async () => {
    mockTag.findMany.mockResolvedValue([row]);
    await listOfficialTags();
    const arg = mockTag.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ isOfficial: true });
    expect(arg.orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    // The picker fetches the vocabulary as one list; a `take` here would
    // silently truncate it with no meta to say so.
    expect(arg.take).toBeUndefined();
  });
});

describe('listTags', () => {
  beforeEach(() => {
    mockTag.findMany.mockResolvedValue([row]);
    mockTag.count.mockResolvedValue(1);
  });

  it('pages, and sorts official tags first', async () => {
    await listTags({ skip: 25, limit: 25 });
    const arg = mockTag.findMany.mock.calls[0][0];
    expect(arg.skip).toBe(25);
    expect(arg.take).toBe(25);
    expect(arg.orderBy).toEqual([{ isOfficial: 'desc' }, { name: 'asc' }]);
  });

  it('searches on the normalized term', async () => {
    await listTags({ q: 'Shoe Gaze', skip: 0, limit: 25 });
    expect(mockTag.findMany.mock.calls[0][0].where).toEqual({
      name: { contains: 'shoe.gaze', mode: 'insensitive' }
    });
  });

  it('counts against the same filter it lists with', async () => {
    await listTags({ q: 'rock', skip: 0, limit: 25 });
    expect(mockTag.count.mock.calls[0][0].where).toEqual(
      mockTag.findMany.mock.calls[0][0].where
    );
  });
});

describe('isOfficialTagName', () => {
  it('is false for a name with no row at all', async () => {
    mockTag.findUnique.mockResolvedValue(null);
    expect(await isOfficialTagName('nothing')).toBe(false);
  });

  it('is false for an ordinary tag', async () => {
    mockTag.findUnique.mockResolvedValue({ isOfficial: false });
    expect(await isOfficialTagName('rock')).toBe(false);
  });

  it('normalizes before looking up, so a variant cannot slip past the guard', async () => {
    mockTag.findUnique.mockResolvedValue({ isOfficial: true });
    expect(await isOfficialTagName('Shoe-Gaze')).toBe(true);
    expect(mockTag.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'shoe.gaze' } })
    );
  });
});
