import { toAuthorRef, toAuthorRefOrNull, type AuthorRefRow } from './authorRef';

const makeRow = (overrides: Partial<AuthorRefRow> = {}): AuthorRefRow => ({
  id: 7,
  username: 'testuser',
  avatar: null,
  isDonor: false,
  warned: null,
  donorRank: null,
  ...overrides
});

describe('toAuthorRef', () => {
  it('carries the donor sign and warning sign (#231)', () => {
    const ref = toAuthorRef(
      makeRow({
        isDonor: true,
        warned: new Date('2026-01-15T12:00:00.000Z'),
        donorRank: {
          expiresAt: null,
          donorRank: { name: 'Patron', badge: 'patron.png', color: '#ffd700' }
        }
      })
    );

    expect(ref).toEqual({
      id: 7,
      username: 'testuser',
      avatar: null,
      isDonor: true,
      donorRank: { name: 'Patron', badge: 'patron.png', color: '#ffd700' },
      warned: '2026-01-15T12:00:00.000Z'
    });
  });

  it('returns null flags for a plain user', () => {
    const ref = toAuthorRef(makeRow());

    expect(ref).toEqual({
      id: 7,
      username: 'testuser',
      avatar: null,
      isDonor: false,
      donorRank: null,
      warned: null
    });
  });

  it('treats an expired donor grant as no rank (sweep-lag guard)', () => {
    const ref = toAuthorRef(
      makeRow({
        isDonor: true,
        donorRank: {
          expiresAt: new Date(Date.now() - 60_000),
          donorRank: { name: 'Patron', badge: 'patron.png', color: '#ffd700' }
        }
      })
    );

    expect(ref.donorRank).toBeNull();
  });

  it('keeps an unexpired dated grant active', () => {
    const ref = toAuthorRef(
      makeRow({
        donorRank: {
          expiresAt: new Date(Date.now() + 60_000),
          donorRank: { name: 'Patron', badge: 'patron.png', color: '#ffd700' }
        }
      })
    );

    expect(ref.donorRank).toEqual({
      name: 'Patron',
      badge: 'patron.png',
      color: '#ffd700'
    });
  });
});

describe('toAuthorRefOrNull', () => {
  it('passes null and undefined through as null', () => {
    expect(toAuthorRefOrNull(null)).toBeNull();
    expect(toAuthorRefOrNull(undefined)).toBeNull();
  });

  it('maps a present row', () => {
    expect(toAuthorRefOrNull(makeRow())?.username).toBe('testuser');
  });
});
