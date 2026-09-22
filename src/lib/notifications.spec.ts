import type { Prisma } from '@prisma/client';
import {
  emitNotifications,
  extractMentionedUsernames,
  extractNewMentionedUsernames
} from './notifications';
import { recipientsWhoCanSee } from '../modules/notificationAccess';

jest.mock('../modules/notificationAccess', () => ({
  recipientsWhoCanSee: jest.fn()
}));

const canSee = recipientsWhoCanSee as jest.MockedFunction<
  typeof recipientsWhoCanSee
>;

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

describe('emitNotifications (#695)', () => {
  const createMany = jest.fn();
  const tx = {
    notification: { createMany }
  } as unknown as Prisma.TransactionClient;

  it('dedupes and drops the actor before asking who can see the target', async () => {
    canSee.mockResolvedValue([2, 3]);
    await emitNotifications(tx, {
      userIds: [2, 3, 2, 9],
      type: 'artist_release',
      actorId: 9,
      page: 'release',
      pageId: 40
    });
    expect(canSee).toHaveBeenCalledWith(tx, 'release', 40, [2, 3]);
  });

  it('writes only the recipients who can see the target', async () => {
    canSee.mockResolvedValue([3]);
    await emitNotifications(tx, {
      userIds: [2, 3],
      type: 'forum_quote',
      page: 'forums',
      pageId: 5,
      postId: 11
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 3,
          type: 'forum_quote',
          actorId: null,
          page: 'forums',
          pageId: 5,
          postId: 11
        }
      ],
      skipDuplicates: true
    });
  });

  it('writes nothing when no recipient can see it', async () => {
    canSee.mockResolvedValue([]);
    await emitNotifications(tx, {
      userIds: [2],
      type: 'artist_release',
      page: 'release',
      pageId: 40
    });
    expect(createMany).not.toHaveBeenCalled();
  });
});
