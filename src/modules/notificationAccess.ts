import { Prisma, SubscriptionPage } from '@prisma/client';
import { getUserRankAccess } from '../lib/userRankAccess';
import {
  communityReadableWhere,
  contributionVisibleTo,
  releaseInPublicCommunity,
  releaseVisibleTo,
  requestVisibleTo
} from './communityAccess';
import { forumReadableWhere } from './forumAccess';

type TxClient = Prisma.TransactionClient;

/** Keep the recipients for whom `canSee` holds. */
const keep = async (
  userIds: number[],
  canSee: (userId: number) => Promise<boolean>
): Promise<number[]> => {
  const verdicts = await Promise.all(userIds.map(canSee));
  return userIds.filter((_, i) => verdicts[i]);
};

const seeRelease = async (
  tx: TxClient,
  releaseId: number,
  userIds: number[]
): Promise<number[]> => {
  // A release anyone can see is one query, not one per recipient: an artist's
  // subscribers can be many, and most releases are in open communities.
  const isPublic = await tx.release.count({
    where: { AND: [{ id: releaseId }, releaseInPublicCommunity] }
  });
  if (isPublic > 0) return userIds;
  return keep(
    userIds,
    async (userId) =>
      (await tx.release.count({
        where: { AND: [{ id: releaseId }, releaseVisibleTo(userId)] }
      })) > 0
  );
};

const seeCommunity = (
  tx: TxClient,
  communityId: number,
  userIds: number[]
): Promise<number[]> =>
  keep(
    userIds,
    async (userId) =>
      (await tx.community.count({
        where: { AND: [{ id: communityId }, communityReadableWhere(userId)] }
      })) > 0
  );

const seeForumTopic = async (
  tx: TxClient,
  topicId: number,
  userIds: number[]
): Promise<number[]> => {
  const topic = await tx.forumTopic.findUnique({
    where: { id: topicId },
    select: { forumId: true }
  });
  if (!topic) return [];
  return keep(userIds, async (userId) => {
    const access = await getUserRankAccess(userId);
    if (!access) return false;
    const readable = await tx.forum.count({
      where: {
        AND: [
          { id: topic.forumId },
          forumReadableWhere({
            userRankLevel: access.effectiveLevel,
            permittedForumIds: access.permittedForumIds
          })
        ]
      }
    });
    return readable > 0;
  });
};

const seeContribution = async (
  tx: TxClient,
  contributionId: number,
  userIds: number[]
): Promise<number[]> => {
  const sees = async (viewerId: number | null) =>
    (await tx.contribution.count({
      where: { AND: [{ id: contributionId }, contributionVisibleTo(viewerId)] }
    })) > 0;
  // The same one-query shortcut as a release: the viewer-less scope is the
  // public one.
  if (await sees(null)) return userIds;
  return keep(userIds, sees);
};

const seeRequest = (
  tx: TxClient,
  requestId: number,
  userIds: number[]
): Promise<number[]> =>
  keep(
    userIds,
    async (userId) =>
      (await tx.request.count({
        where: { AND: [{ id: requestId }, requestVisibleTo(userId)] }
      })) > 0
  );

type Check = (
  tx: TxClient,
  pageId: number,
  userIds: number[]
) => Promise<number[]>;

const everyone: Check = async (_tx, _pageId, userIds) => userIds;

/**
 * One rule per page. A `Record` over the enum rather than a `switch`, and still
 * exhaustive: a new `SubscriptionPage` fails to compile here until someone
 * decides who may see it.
 */
const CHECKS: Record<SubscriptionPage, Check> = {
  release: seeRelease,
  contributions: seeContribution,
  requests: seeRequest,
  communities: seeCommunity,
  forums: seeForumTopic,
  artist: everyone,
  collages: everyone,
  news: everyone,
  global_notices: everyone
};

/**
 * Who, of these recipients, can see a notification's target (#695).
 *
 * EMIT-TIME, AND ONLY EMIT-TIME. A notification is written for a recipient who
 * can see its target when it is sent, and for no one else. Nothing re-checks on
 * read: a member who later loses access keeps what they were sent while they had
 * it, and rows written before this rule are not cleaned up. That was decided on
 * #695 — read-time filtering would put a recount on every badge poll to cover a
 * case the rule deliberately excludes.
 *
 * Every rule here is the canonical one, reused rather than restated:
 * `releaseVisibleTo` (ADR-0036) for releases, `contributionVisibleTo` and
 * `requestVisibleTo` for their pages (#697), `communityReadableWhere` for
 * community pages, and `forumReadableWhere` for forum topics, over the
 * recipient's own rank access — the same `effectiveLevel` the auth middleware
 * puts on `req.user`.
 *
 * Queries run on the caller's TRANSACTION client. A new topic's first post can
 * quote someone in the same transaction that creates the topic; the global
 * client cannot see that topic yet.
 *
 * `artist`, `collages`, `news` and `global_notices` are site-wide, so every
 * recipient passes. A target that does not exist reaches no one.
 */
export const recipientsWhoCanSee = (
  tx: TxClient,
  page: SubscriptionPage,
  pageId: number,
  userIds: number[]
): Promise<number[]> =>
  userIds.length === 0
    ? Promise.resolve([])
    : CHECKS[page](tx, pageId, userIds);
