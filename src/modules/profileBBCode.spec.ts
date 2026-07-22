/**
 * Phase 2 of #398/#402: profile info is stored as RAW BBCode and transcribed at
 * read time via renderBBCode — the pre-#398 store-time parse (parseBBCode +
 * sanitizeHtml) is gone. This locks the store-side flip: the editor must be able
 * to round-trip its source, so what lands in the DB is the raw body, not HTML.
 */

const prismaMock = {
  user: { findUnique: jest.fn() },
  profile: { update: jest.fn() },
  userSettings: { update: jest.fn() },
  $transaction: jest.fn()
};

jest.mock('../lib/prisma', () => ({ prisma: prismaMock }));

// Keep isomorphic-dompurify (jsdom ESM) out of the jest graph — the transitive
// pulls through profile.ts. Render output itself is covered by bbcode.spec.ts.
jest.mock('../lib/sanitize', () => ({
  sanitizeHtml: (v: string) => v,
  sanitizePlain: (v: string) => v
}));
jest.mock('../lib/bbcode/sanitizeConfig', () => ({
  sanitizeBBCode: (v: string) => v
}));

import { updateProfile } from './profile';

describe('updateProfile — profileInfo storage (#402)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // updateProfile self-reads via getProfileById; a null user short-circuits it.
    prismaMock.user.findUnique.mockResolvedValue({
      profileId: 42,
      userSettingsId: 7
    });
    prismaMock.$transaction.mockResolvedValue([]);
  });

  it('persists raw BBCode verbatim — no store-time HTML transform', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      profileId: 42,
      userSettingsId: 7
    });
    prismaMock.user.findUnique.mockResolvedValue(null); // getProfileById → null

    await updateProfile(1, { profileInfo: '[b]hello[/b]' });

    expect(prismaMock.profile.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { profileInfo: '[b]hello[/b]' }
    });
  });

  it('stores null for an emptied profileInfo', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      profileId: 42,
      userSettingsId: 7
    });
    prismaMock.user.findUnique.mockResolvedValue(null);

    await updateProfile(1, { profileInfo: '' });

    expect(prismaMock.profile.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { profileInfo: null }
    });
  });

  it('leaves profileInfo untouched when the field is absent from the patch', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      profileId: 42,
      userSettingsId: 7
    });
    prismaMock.user.findUnique.mockResolvedValue(null);

    await updateProfile(1, { profileTitle: 'hi' });

    expect(prismaMock.profile.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { profileTitle: 'hi' }
    });
  });
});
