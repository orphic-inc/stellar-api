import {
  ReleaseType,
  ReleaseCategory,
  CommentPage,
  RequestStatus,
  SubscriptionPage
} from '@prisma/client';
import type {
  Prisma,
  UserRank,
  User,
  Forum,
  ForumTopic,
  ForumPost,
  ForumTopicNote,
  Post,
  PostComment,
  Comment,
  Notification,
  Collage,
  CollageEntry,
  CollageSubscription,
  BookmarkCollage,
  Release,
  Request
} from '@prisma/client';

export const TEST_USER_ID = 7;

// ─── UserRank ──────────────────────────────────────────────────────────────────

export function makeUserRank(
  permissions: Record<string, boolean> = {}
): UserRank {
  return {
    id: 1,
    name: 'User',
    level: 1000,
    color: '',
    badge: '',
    permissions,
    uploadRequired: 0
  };
}

// ─── User ─────────────────────────────────────────────────────────────────────

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: TEST_USER_ID,
    username: 'testuser',
    email: 'testuser@example.com',
    password: 'hashed-password',
    avatar: null,
    userRankId: 1,
    userSettingsId: 1,
    profileId: 1,
    inviteCount: 0,
    uploaded: BigInt(0),
    downloaded: BigInt(0),
    totalEarned: BigInt(0),
    ratio: 1.0,
    ratioWatchDownload: null,
    lastLogin: null,
    dateRegistered: new Date(),
    disabled: false,
    isArtist: false,
    isDonor: false,
    canDownload: true,
    adminComment: null,
    banDate: null,
    banReason: null,
    warned: null,
    warnedTimes: 0,
    communityPass: '',
    disablePm: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

/**
 * Casts a partial user-shaped object to User for mockResolvedValue calls where
 * the route uses a Prisma select (returning a subset, not the full User model).
 * The cast is safe because the mock returns exactly what you provide — the
 * Prisma select does not run against the mock.
 */
export function asUserMock<T extends Record<string, unknown>>(value: T): User {
  return value as unknown as User;
}

// ─── Forum ────────────────────────────────────────────────────────────────────

export function makeForum(overrides: Partial<Forum> = {}): Forum {
  return {
    id: 1,
    forumCategoryId: 1,
    sort: 0,
    name: 'Test Forum',
    description: '',
    minClassRead: 0,
    minClassWrite: 0,
    minClassCreate: 0,
    numTopics: 0,
    numPosts: 0,
    autoLock: true,
    autoLockWeeks: 4,
    isTrash: false,
    lastTopicId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

/**
 * Returns a partial list of forum-shaped objects cast to Forum[]. Used when
 * the test needs to assert on only a few fields of the response.
 */
export function makeForumList(items: Array<Partial<Forum>>): Forum[] {
  return items as unknown as Forum[];
}

// ─── ForumTopic ───────────────────────────────────────────────────────────────

export function makeForumTopic(
  overrides: Partial<ForumTopic> = {}
): ForumTopic {
  return {
    id: 44,
    forumId: 1,
    threadId: null,
    title: 'Test Topic',
    authorId: TEST_USER_ID,
    isLocked: false,
    isSticky: false,
    ranking: 0,
    numPosts: 0,
    lastPostId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides
  };
}

// ─── ForumPost ────────────────────────────────────────────────────────────────

export function makeForumPost(overrides: Partial<ForumPost> = {}): ForumPost {
  return {
    id: 21,
    forumTopicId: 44,
    authorId: TEST_USER_ID,
    body: 'Test post body',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides
  };
}

// ─── ForumTopicNote ───────────────────────────────────────────────────────────

export function makeForumTopicNote(
  overrides: Partial<ForumTopicNote> = {}
): ForumTopicNote {
  return {
    id: 77,
    forumTopicId: 44,
    authorId: TEST_USER_ID,
    body: 'Staff note body',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// ─── Post ─────────────────────────────────────────────────────────────────────

export function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 14,
    userId: TEST_USER_ID,
    title: 'Test Post',
    text: 'Some text content',
    category: 'news',
    tags: [],
    createdAt: new Date(),
    ...overrides
  };
}

type PostWithIncludes = Post & {
  user: { id: number; username: string; avatar: string | null };
  comments: Array<PostCommentWithUser>;
};

export function makePostWithIncludes(
  overrides: Partial<PostWithIncludes> = {}
): PostWithIncludes {
  return {
    ...makePost(),
    user: { id: TEST_USER_ID, username: 'testuser', avatar: null },
    comments: [],
    ...overrides
  } as PostWithIncludes;
}

// ─── PostComment ──────────────────────────────────────────────────────────────

export function makePostComment(
  overrides: Partial<PostComment> = {}
): PostComment {
  return {
    id: 5,
    postId: 14,
    userId: TEST_USER_ID,
    text: 'Test comment',
    createdAt: new Date(),
    ...overrides
  };
}

type PostCommentWithUser = PostComment & {
  user: { id: number; username: string; avatar: string | null };
};

export function makePostCommentWithUser(
  overrides: Partial<PostCommentWithUser> = {}
): PostCommentWithUser {
  return {
    ...makePostComment(),
    user: { id: TEST_USER_ID, username: 'testuser', avatar: null },
    ...overrides
  } as PostCommentWithUser;
}

// ─── Comment ──────────────────────────────────────────────────────────────────

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 12,
    page: CommentPage.communities,
    authorId: TEST_USER_ID,
    body: 'Test comment body',
    editedUserId: null,
    editedAt: null,
    artistId: null,
    communityId: null,
    contributionId: null,
    releaseId: null,
    collageId: null,
    createdAt: new Date(),
    deletedAt: null,
    ...overrides
  };
}

type CommentWithAuthor = Comment & {
  author: { id: number; username: string; avatar: string | null };
};

export function makeCommentWithAuthor(
  overrides: Partial<CommentWithAuthor> = {}
): CommentWithAuthor {
  return {
    ...makeComment(),
    author: { id: TEST_USER_ID, username: 'testuser', avatar: null },
    ...overrides
  } as CommentWithAuthor;
}

// ─── Notification ─────────────────────────────────────────────────────────────

export function makeNotification(
  overrides: Partial<Notification> = {}
): Notification {
  return {
    id: 8,
    userId: TEST_USER_ID,
    quoterId: 99,
    page: SubscriptionPage.forums,
    pageId: 1,
    postId: 1,
    createdAt: new Date(),
    ...overrides
  };
}

// ─── Collage ──────────────────────────────────────────────────────────────────

export function makeCollage(overrides: Partial<Collage> = {}): Collage {
  return {
    id: 1,
    name: 'Test Collage',
    description: 'A sufficiently long description for testing purposes.',
    userId: TEST_USER_ID,
    categoryId: 1,
    tags: ['jazz'],
    isLocked: false,
    isDeleted: false,
    maxEntries: 0,
    maxEntriesPerUser: 0,
    isFeatured: false,
    numEntries: 2,
    numSubscribers: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides
  };
}

export type CollageDetail = Prisma.CollageGetPayload<{
  include: {
    user: { select: { id: true; username: true; avatar: true } };
    _count: { select: { entries: true; subscriptions: true; bookmarks: true } };
    entries: {
      orderBy: { sort: 'asc' };
      include: {
        release: {
          select: {
            id: true;
            title: true;
            image: true;
            year: true;
            releaseType: true;
            artist: { select: { id: true; name: true } };
          };
        };
        user: { select: { id: true; username: true } };
      };
    };
  };
}>;

export function makeCollageDetail(
  overrides: Partial<CollageDetail> = {}
): CollageDetail {
  return {
    ...makeCollage(),
    user: { id: TEST_USER_ID, username: 'testuser', avatar: null },
    _count: { entries: 2, subscriptions: 3, bookmarks: 1 },
    entries: [],
    ...overrides
  } as CollageDetail;
}

// ─── CollageEntry ─────────────────────────────────────────────────────────────

export function makeCollageEntry(
  overrides: Partial<CollageEntry> = {}
): CollageEntry {
  return {
    id: 10,
    collageId: 1,
    releaseId: 42,
    userId: TEST_USER_ID,
    sort: 10,
    addedAt: new Date(),
    ...overrides
  };
}

export type CollageEntryDetail = Prisma.CollageEntryGetPayload<{
  include: {
    release: {
      select: {
        id: true;
        title: true;
        image: true;
        year: true;
        releaseType: true;
        artist: { select: { id: true; name: true } };
      };
    };
    user: { select: { id: true; username: true } };
  };
}>;

export function makeCollageEntryDetail(
  overrides: Partial<CollageEntryDetail> = {}
): CollageEntryDetail {
  return {
    ...makeCollageEntry(),
    release: {
      id: 42,
      title: 'Kind of Blue',
      image: null,
      year: 1959,
      releaseType: ReleaseCategory.Album,
      artist: { id: 5, name: 'Miles Davis' }
    },
    user: { id: TEST_USER_ID, username: 'testuser' },
    ...overrides
  } as CollageEntryDetail;
}

// ─── CollageSubscription ──────────────────────────────────────────────────────

export function makeCollageSubscription(
  overrides: Partial<CollageSubscription> = {}
): CollageSubscription {
  return {
    id: 1,
    userId: TEST_USER_ID,
    collageId: 1,
    lastVisit: new Date(),
    ...overrides
  };
}

// ─── BookmarkCollage ──────────────────────────────────────────────────────────

export function makeBookmarkCollage(
  overrides: Partial<BookmarkCollage> = {}
): BookmarkCollage {
  return {
    id: 1,
    userId: TEST_USER_ID,
    collageId: 1,
    createdAt: new Date(),
    ...overrides
  };
}

// ─── Release ──────────────────────────────────────────────────────────────────

export function makeRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: 42,
    artistId: 5,
    title: 'Kind of Blue',
    image: null,
    description: '',
    communityId: null,
    type: ReleaseType.Music,
    releaseType: ReleaseCategory.Album,
    year: 1959,
    isEdition: false,
    edition: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// ─── CollageEntry aggregate ───────────────────────────────────────────────────

/**
 * Returns an aggregate result shape for collageEntry.aggregate mocks.
 * The mock typing requires all aggregate fields even when only _max was
 * requested in the actual query.
 */
export function makeEntryAggregateResult(maxSort: number | null = null) {
  return {
    _count: { sort: 0 },
    _avg: { sort: null },
    _sum: { sort: null },
    _min: { sort: null },
    _max: { sort: maxSort }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ─── Request ──────────────────────────────────────────────────────────────────

export function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    id: 1,
    communityId: 1,
    userId: TEST_USER_ID,
    title: 'Test Request',
    description: 'A test request description',
    type: ReleaseType.Music,
    year: null,
    image: null,
    status: RequestStatus.open,
    fillerId: null,
    filledAt: null,
    filledContributionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides
  };
}
