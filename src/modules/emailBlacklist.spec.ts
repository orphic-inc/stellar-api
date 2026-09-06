import {
  normalizeEmail,
  blacklistKeysFor,
  isMatchableBlacklistEntry
} from './emailBlacklist';

describe('normalizeEmail', () => {
  it('folds case and trims', () => {
    expect(normalizeEmail('  Spam@Example.COM ')).toBe('spam@example.com');
  });
});

describe('blacklistKeysFor', () => {
  it('yields the address and its domain', () => {
    expect(blacklistKeysFor('user@spam.example')).toEqual([
      'user@spam.example',
      'spam.example'
    ]);
  });

  it('normalises before splitting', () => {
    expect(blacklistKeysFor('User@Spam.Example')).toEqual([
      'user@spam.example',
      'spam.example'
    ]);
  });

  it('splits on the LAST @, not the first', () => {
    // Local parts may contain a quoted @; the domain is always after the last.
    expect(blacklistKeysFor('a@b@spam.example')).toEqual([
      'a@b@spam.example',
      'spam.example'
    ]);
  });

  it('yields a single key when there is no usable domain', () => {
    for (const odd of ['nodomain', '@leading', 'trailing@']) {
      expect(blacklistKeysFor(odd)).toHaveLength(1);
    }
  });

  it('does not produce a subdomain key', () => {
    // Literal matching only: an entry of `example.com` must not block
    // `@mail.example.com`. Widening a ban past what the moderator typed is a
    // decision, not a default.
    expect(blacklistKeysFor('user@mail.example.com')).not.toContain(
      'example.com'
    );
  });
});

describe('isMatchableBlacklistEntry', () => {
  it('accepts full addresses and bare domains', () => {
    for (const ok of [
      'spam@example.com',
      'example.com',
      'sub.example.co.uk',
      'SPAM@Example.com'
    ]) {
      expect(isMatchableBlacklistEntry(ok)).toBe(true);
    }
  });

  it('rejects entries that could never match', () => {
    // These are accepted by the old `z.string().min(1)` and can never fire.
    for (const bad of [
      'known spammer',
      'spam',
      'localhost',
      '@example.com',
      'user@',
      ''
    ]) {
      expect(isMatchableBlacklistEntry(bad)).toBe(false);
    }
  });
});
