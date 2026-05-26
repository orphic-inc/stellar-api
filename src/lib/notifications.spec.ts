import {
  extractMentionedUsernames,
  extractNewMentionedUsernames
} from './notifications';

describe('extractMentionedUsernames', () => {
  it('extracts a single username', () => {
    expect(extractMentionedUsernames('[quote=alice]hello[/quote]')).toEqual([
      'alice'
    ]);
  });

  it('extracts multiple distinct usernames', () => {
    const result = extractMentionedUsernames(
      '[quote=alice]first[/quote] text [quote=bob]second[/quote]'
    );
    expect(result).toEqual(['alice', 'bob']);
  });

  it('deduplicates repeated quotes of the same user', () => {
    const result = extractMentionedUsernames(
      '[quote=alice]one[/quote] [quote=alice]two[/quote]'
    );
    expect(result).toEqual(['alice']);
  });

  it('returns an empty array when there are no quote tags', () => {
    expect(extractMentionedUsernames('Just a plain post.')).toEqual([]);
  });

  it('is case-insensitive for the [QUOTE] tag itself', () => {
    expect(extractMentionedUsernames('[QUOTE=Alice]hi[/QUOTE]')).toEqual([
      'Alice'
    ]);
  });

  it('trims whitespace around the username', () => {
    expect(extractMentionedUsernames('[quote= alice ]body[/quote]')).toEqual([
      'alice'
    ]);
  });
});

describe('extractNewMentionedUsernames', () => {
  it('returns usernames present in newBody but absent in currentBody', () => {
    const result = extractNewMentionedUsernames(
      'old text',
      '[quote=alice]new quote[/quote]'
    );
    expect(result).toEqual(['alice']);
  });

  it('omits usernames already present in currentBody (case-insensitive)', () => {
    const result = extractNewMentionedUsernames(
      '[quote=Alice]prior quote[/quote]',
      '[quote=alice]same quote[/quote] plus more'
    );
    expect(result).toEqual([]);
  });

  it('returns only the newly introduced username when one is old and one is new', () => {
    const result = extractNewMentionedUsernames(
      '[quote=alice]already here[/quote]',
      '[quote=alice]still here[/quote] [quote=bob]new[/quote]'
    );
    expect(result).toEqual(['bob']);
  });

  it('returns empty array when no new quotes are introduced', () => {
    const result = extractNewMentionedUsernames('plain', 'also plain');
    expect(result).toEqual([]);
  });
});
