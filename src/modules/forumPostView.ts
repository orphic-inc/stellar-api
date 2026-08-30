import { prisma } from '../lib/prisma';
import { authorRefSelect, toAuthorRefOrNull } from './authorRef';
import { renderSiteBBCode } from './bbcodeRender';

/**
 * The read shape every forum-post surface returns.
 *
 * Two of them exist — the posts routes in `routes/api/forum/forumPost.ts` and
 * the composed topic read in `modules/topicSession.ts` — and each carried its
 * own copy of the include, the row type derived from it, and the serializer.
 * `topicSession` even said so, with a `// mirrors forumPost.ts` banner over its
 * half, so the duplication was known rather than accidental; what was missing
 * was somewhere for it to live.
 *
 * The pair is deliberately shaped like `authorRef`'s — a `*Include`/`*Select`
 * constant beside the mapper that consumes it — because the failure mode is the
 * same: a surface that selects the right columns but shapes them differently
 * returns a payload the UI renders with one component and two behaviours. Here
 * the `lastEdit` collapsing is the part worth pinning, since it is the only
 * place the raw `edits` array is traded for a single field.
 */
export const publicPostInclude = {
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

export type RawForumPost = Awaited<
  ReturnType<
    typeof prisma.forumPost.findMany<{ include: typeof publicPostInclude }>
  >
>[number];

/**
 * Shape one post for a response.
 *
 * Additive render-at-read: `body` is unchanged; `bodyHtml` is the
 * server-rendered transcription display surfaces consume (#402). The single
 * newest edit is lifted to `lastEdit` and the `edits` array dropped, so callers
 * never have to know the include took `take: 1`.
 */
export const serializeForumPost = async (post: RawForumPost) => ({
  ...post,
  author: toAuthorRefOrNull(post.author),
  bodyHtml: await renderSiteBBCode(post.body),
  ...(post.edits?.[0] ? { lastEdit: post.edits[0] } : {}),
  edits: undefined
});
