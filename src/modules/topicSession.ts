import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { canAccessForumLevel } from '../lib/userRankAccess';
import {
  createPost,
  updateTopic as forumUpdateTopic,
  deleteTopic as forumDeleteTopic,
  trashTopic as forumTrashTopic,
  castVote
} from './forum';
import { authorRefSelect, toAuthorRefOrNull } from './authorRef';
import { renderSiteBBCode } from './bbcodeRender';
import type { PageParams } from '../lib/pagination';

// ─── Actor ───────────────────────────────────────────────────────────────────

export type TopicSessionActor = {
  actorId: number;
  userRankLevel: number;
  permittedForumIds?: number[];
  canModerateForums: boolean;
};

// ─── Affordances & ReadState ──────────────────────────────────────────────────

type TopicSessionAffordances = {
  canReply: boolean;
  canModerate: boolean;
  canVoteInPoll: boolean;
  canSubscribe: boolean;
  canCatchUp: boolean;
};

type TopicSessionReadState = {
  lastVisiblePostId: number | null;
};

// ─── Post serialization (mirrors forumPost.ts) ─────────────────────────────

const publicPostInclude = {
  author: { select: authorRefSelect },
  edits: {
    orderBy: { editedAt: 'desc' as const },
    take: 1,
    select: {
      id: true,
      forumPostId: true,
      editorId: true,
      editedAt: true,
      editor: { select: { id: true, username: true } }
    }
  }
} as const;

type RawPost = Awaited<
  ReturnType<
    typeof prisma.forumPost.findMany<{ include: typeof publicPostInclude }>
  >
>[number];

const serializePost = async (post: RawPost) => ({
  ...post,
  author: toAuthorRefOrNull(post.author),
  // Additive render-at-read: raw `body` is unchanged; `bodyHtml` is the
  // server-rendered transcription display surfaces consume (#402).
  bodyHtml: await renderSiteBBCode(post.body),
  ...(post.edits?.[0] ? { lastEdit: post.edits[0] } : {}),
  edits: undefined
});

// ─── getTopicSession ──────────────────────────────────────────────────────────

/**
 * Assembles the full topic-session view model in a single call.
 * Throws AppError (404 / 403) rather than returning a result union —
 * the route handler wraps this in authHandler which forwards to next(err).
 */
export const getTopicSession = async (
  forumId: number,
  topicId: number,
  actor: TopicSessionActor,
  pg: PageParams
) => {
  // Forum — existence + class access
  const forum = await prisma.forum.findUnique({
    where: { id: forumId },
    select: {
      id: true,
      name: true,
      forumCategoryId: true,
      forumCategory: { select: { id: true, name: true } },
      minClassRead: true,
      minClassWrite: true,
      minClassCreate: true
    }
  });
  if (!forum) throw new AppError(404, 'Forum not found');
  if (!canAccessForumLevel(actor, forumId, forum.minClassRead)) {
    throw new AppError(403, 'Insufficient class to read this forum');
  }

  // Topic
  const topic = await prisma.forumTopic.findFirst({
    where: { id: topicId, forumId, deletedAt: null },
    include: {
      author: { select: authorRefSelect },
      notes: {
        include: { author: { select: { id: true, username: true } } }
      }
    }
  });
  if (!topic) throw new AppError(404, 'Topic not found');
  const topicWithAuthor = { ...topic, author: toAuthorRefOrNull(topic.author) };

  // Posts, poll, and subscription — all parallel
  const [posts, total, poll, subscription] = await Promise.all([
    prisma.forumPost.findMany({
      where: {
        forumTopicId: topicId,
        deletedAt: null,
        forumTopic: { forumId, deletedAt: null }
      },
      orderBy: { createdAt: 'asc' },
      skip: pg.skip,
      take: pg.limit,
      include: publicPostInclude
    }),
    prisma.forumPost.count({
      where: {
        forumTopicId: topicId,
        deletedAt: null,
        forumTopic: { forumId, deletedAt: null }
      }
    }),
    prisma.forumPoll.findUnique({
      where: { forumTopicId: topicId },
      include: { votes: true }
    }),
    prisma.subscription.findUnique({
      where: { userId_topicId: { userId: actor.actorId, topicId } }
    })
  ]);

  const serializedPosts = await Promise.all(posts.map(serializePost));
  const lastVisiblePostId =
    serializedPosts.length > 0
      ? serializedPosts[serializedPosts.length - 1].id
      : null;

  // Affordances
  const myVote = poll?.votes.find((v) => v.userId === actor.actorId);

  const affordances: TopicSessionAffordances = {
    canReply: !topic.isLocked || actor.canModerateForums,
    canModerate: actor.canModerateForums,
    canVoteInPoll: !!poll && !poll.closed && myVote === undefined,
    canSubscribe: true,
    canCatchUp: true
  };

  const readState: TopicSessionReadState = {
    lastVisiblePostId
  };

  return {
    forum: {
      id: forum.id,
      name: forum.name,
      forumCategoryId: forum.forumCategoryId,
      forumCategory: forum.forumCategory
    },
    topic: topicWithAuthor,
    posts: {
      data: serializedPosts,
      meta: {
        total,
        page: pg.page,
        limit: pg.limit,
        totalPages: Math.ceil(total / pg.limit)
      }
    },
    poll,
    subscription: { isSubscribed: !!subscription },
    affordances,
    readState
  };
};

// ─── Result types for command operations ─────────────────────────────────────

export type TopicUpdateResult =
  | { ok: true; topic: Awaited<ReturnType<typeof forumUpdateTopic>> }
  | { ok: false; reason: 'not_found' | 'not_authorized' };

export type TopicDeleteResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_authorized' };

export type TopicTrashResult =
  | { ok: true; topic: Awaited<ReturnType<typeof forumUpdateTopic>> }
  | {
      ok: false;
      reason: 'not_found' | 'not_authorized' | 'no_trash' | 'already_trash';
    };

// ─── updateTopic ──────────────────────────────────────────────────────────────

/**
 * Updates topic fields. Enforces owner-or-moderator authorization before
 * delegating to the forum module.
 */
export const updateTopic = async (
  id: number,
  forumId: number,
  actor: TopicSessionActor,
  data: { title?: string; isLocked?: boolean; isSticky?: boolean }
): Promise<TopicUpdateResult> => {
  const topic = await prisma.forumTopic.findFirst({
    where: { id, forumId, deletedAt: null }
  });
  if (!topic) return { ok: false, reason: 'not_found' };

  const isOwner = topic.authorId === actor.actorId;
  if (!isOwner && !actor.canModerateForums) {
    return { ok: false, reason: 'not_authorized' };
  }

  const updated = await forumUpdateTopic(id, data);
  return { ok: true, topic: updated };
};

// ─── deleteTopic ──────────────────────────────────────────────────────────────

/**
 * Soft-deletes a topic. Enforces owner-or-moderator authorization.
 */
export const deleteTopic = async (
  id: number,
  forumId: number,
  actor: TopicSessionActor
): Promise<TopicDeleteResult> => {
  const topic = await prisma.forumTopic.findFirst({
    where: { id, forumId, deletedAt: null }
  });
  if (!topic) return { ok: false, reason: 'not_found' };

  const isOwner = topic.authorId === actor.actorId;
  if (!isOwner && !actor.canModerateForums) {
    return { ok: false, reason: 'not_authorized' };
  }

  await forumDeleteTopic(id, topic.forumId, actor.actorId, !isOwner);
  return { ok: true };
};

// ─── trashTopic ──────────────────────────────────────────────────────────────

/**
 * Moves a topic to the trash board. Moderator-only.
 */
export const trashTopic = async (
  id: number,
  forumId: number,
  actor: TopicSessionActor
): Promise<TopicTrashResult> => {
  if (!actor.canModerateForums) {
    return { ok: false, reason: 'not_authorized' };
  }

  const topic = await prisma.forumTopic.findFirst({
    where: { id, forumId, deletedAt: null }
  });
  if (!topic) return { ok: false, reason: 'not_found' };

  const result = await forumTrashTopic(id);
  if (!result.ok) return result;
  return { ok: true, topic: result.topic };
};

// ─── replyToTopic ─────────────────────────────────────────────────────────────

/**
 * Creates a reply in a topic. Validates forum and topic existence and enforces
 * the locked constraint before delegating to createPost, which owns double-post
 * merge, counter updates, and notification emission.
 */
export const replyToTopic = async (
  forumId: number,
  forumTopicId: number,
  actor: TopicSessionActor,
  body: string
) => {
  const [forum, topic] = await Promise.all([
    prisma.forum.findUnique({ where: { id: forumId }, select: { id: true } }),
    prisma.forumTopic.findFirst({
      where: { id: forumTopicId, forumId, deletedAt: null }
    })
  ]);
  if (!forum) throw new AppError(404, 'Forum not found');
  if (!topic) throw new AppError(404, 'Forum topic not found');
  if (topic.isLocked && !actor.canModerateForums) {
    throw new AppError(403, 'Topic is locked');
  }
  return createPost(forumId, forumTopicId, actor.actorId, body);
};

// ─── voteTopicPoll ────────────────────────────────────────────────────────────

/**
 * Casts or updates a poll vote. Delegates to castVote which owns poll-state
 * and class access validation.
 */
export const voteTopicPoll = (
  forumPollId: number,
  actor: TopicSessionActor,
  vote: number
) =>
  castVote(
    forumPollId,
    {
      id: actor.actorId,
      userRankLevel: actor.userRankLevel,
      permittedForumIds: actor.permittedForumIds ?? []
    },
    vote
  );

// ─── markTopicRead ────────────────────────────────────────────────────────────

/**
 * Upserts a last-read marker for the actor on a topic. Validates the post
 * is accessible and belongs to the topic before writing.
 */
export const markTopicRead = async (
  forumTopicId: number,
  forumPostId: number,
  actor: TopicSessionActor
) => {
  const post = await prisma.forumPost.findFirst({
    where: {
      id: forumPostId,
      forumTopicId,
      deletedAt: null,
      forumTopic: { deletedAt: null }
    },
    include: {
      forumTopic: {
        select: {
          forumId: true,
          forum: { select: { minClassRead: true } }
        }
      }
    }
  });
  if (!post) throw new AppError(404, 'Forum post not found');
  if (
    !canAccessForumLevel(
      actor,
      post.forumTopic?.forumId ?? 0,
      post.forumTopic?.forum.minClassRead
    )
  ) {
    throw new AppError(403, 'Insufficient class to read this forum');
  }

  return prisma.forumLastReadTopic.upsert({
    where: { userId_forumTopicId: { userId: actor.actorId, forumTopicId } },
    create: { userId: actor.actorId, forumTopicId, forumPostId },
    update: { forumPostId }
  });
};
