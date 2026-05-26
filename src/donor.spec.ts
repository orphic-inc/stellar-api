jest.mock('./lib/sanitize', () => ({
  sanitizeHtml: (v: string) => v,
  sanitizePlain: (v: string) => v
}));
jest.mock('./lib/prisma', () => ({
  prisma: {}
}));

import { parsePerks } from './modules/donor';

// Unit tests for module-level logic that doesn't require DB access.
// DB-dependent functions are covered via integration tests or via the route
// spec tests (donorRewards.spec.ts) which mock the whole module.

describe('parsePerks', () => {
  it('returns the object as PerksMap when given a valid object', () => {
    const raw = { customIcon: true, forumTitle: false };
    expect(parsePerks(raw)).toEqual({ customIcon: true, forumTitle: false });
  });

  it('returns empty object for null', () => {
    expect(parsePerks(null)).toEqual({});
  });

  it('returns empty object for undefined', () => {
    expect(parsePerks(undefined)).toEqual({});
  });

  it('returns empty object for an array', () => {
    expect(parsePerks(['customIcon', true])).toEqual({});
  });

  it('returns empty object for a string', () => {
    expect(parsePerks('customIcon')).toEqual({});
  });

  it('returns empty object for an empty JSON object', () => {
    expect(parsePerks({})).toEqual({});
  });

  it('preserves all perk keys when present', () => {
    const raw = {
      iconMouseOverText: true,
      avatarMouseOverText: false,
      customIconLink: true,
      customIcon: true,
      forumTitle: true,
      secondAvatar: false,
      profileInfo1: true,
      profileInfo2: true,
      profileInfo3: false,
      profileInfo4: false
    };
    const result = parsePerks(raw);
    expect(result).toEqual(raw);
  });
});
