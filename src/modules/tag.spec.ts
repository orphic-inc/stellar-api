/**
 * Unit tests for the curated tag vocabulary (#298, ADR-0045).
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
  foldTagName,
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

describe('foldTagName', () => {
  it('lowercases and trims, so the curated set cannot hold two casings', () => {
    expect(foldTagName('  Shoegaze ')).toBe('shoegaze');
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

  it('folds the name before it reaches the table', async () => {
    await promoteTag('  ShoeGaze ');
    expect(mockTag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'shoegaze' } })
    );
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

  it('resolves the alias on the FOLDED name', async () => {
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

  it('searches case-insensitively on the folded term', async () => {
    await listTags({ q: 'ShoeGaze', skip: 0, limit: 25 });
    expect(mockTag.findMany.mock.calls[0][0].where).toEqual({
      name: { contains: 'shoegaze', mode: 'insensitive' }
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

  it('folds before looking up, so casing cannot slip past the guard', async () => {
    mockTag.findUnique.mockResolvedValue({ isOfficial: true });
    expect(await isOfficialTagName('ShoeGaze')).toBe(true);
    expect(mockTag.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'shoegaze' } })
    );
  });
});
