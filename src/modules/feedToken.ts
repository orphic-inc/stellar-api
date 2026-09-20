/**
 * The Member Feed token (ADR-0014, #262): derived, never stored.
 *
 * A feed reader cannot hold a session, so a Member Feed URL carries the owner's
 * id and a token in its query string. The token is recomputed on every request
 * from the owner's id, their `feedTokenEpoch` and `STELLAR_FEED_SECRET`, and
 * compared in constant time. Nothing secret is written anywhere, which is the
 * whole point: ADR-0013 deleted the stored per-user AnnounceKey because a
 * second credential store drifts, and this must not bring one back.
 *
 * Revocation is a counter. Bumping one member's epoch changes their token, so
 * every URL they have handed out stops working; rotating the secret does that
 * for everyone at once.
 *
 * Three things here are deliberate and not obvious from the ADR:
 *
 *  - `authenticateFeedOwner` answers `null` for EVERY failure — feeds disabled,
 *    a malformed token, an unknown id, a wrong token, a disabled member. The
 *    route turns all of them into one identical 404, so a feed URL can never
 *    confirm that an id exists. Keep it one value; a reason code here would be
 *    one refactor away from leaking into a response.
 *  - The URLs are built here, not in the UI. The settings read hands the member
 *    complete URLs and never a bare token, so the route shape has one owner and
 *    there is no token field to paste somewhere by mistake.
 *  - A rotation's `reason` is for staff and lives in the audit row; `message`
 *    is for the member and is sent as a System PM after the write commits, as
 *    #636's staff writes do. Staff never see the member's URLs.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { AppError } from '../lib/errors';
import { email, feeds, site } from './config';
import { getLogger } from './logging';
import { sendSystemMessage } from './pm';

const log = getLogger('feedToken');

/** 128 bits, hex. Short enough for a URL, far past guessable. */
export const FEED_TOKEN_LENGTH = 32;

/** The v1 catalog (ADR-0014 §3). The routes serving them arrive with #262's feeds PR. */
export const MEMBER_FEEDS = [
  'contributions',
  'mine',
  'news',
  'bookmarks'
] as const;
export type MemberFeedName = (typeof MEMBER_FEEDS)[number];

export type MemberFeeds =
  { enabled: false } | { enabled: true; feeds: Record<MemberFeedName, string> };

const FEED_TOKEN_SHAPE = new RegExp(`^[0-9a-f]{${FEED_TOKEN_LENGTH}}$`);

export const feedsEnabled = (): boolean => feeds.secret !== '';

/** The token for one member at one epoch. Only meaningful while feeds are enabled. */
export const deriveFeedToken = (userId: number, epoch: number): string =>
  createHmac('sha256', feeds.secret)
    .update(`feed:${userId}:${epoch}`)
    .digest('hex')
    .slice(0, FEED_TOKEN_LENGTH);

/**
 * Constant-time comparison. The shape check runs first because
 * `timingSafeEqual` throws on unequal lengths; both sides are then fixed-length
 * hex, so the only thing a timing difference could reveal is already public.
 */
export const feedTokenMatches = (expected: string, presented: string) =>
  FEED_TOKEN_SHAPE.test(presented) &&
  timingSafeEqual(Buffer.from(expected), Buffer.from(presented));

/**
 * Who owns this feed URL, or `null` for any reason at all. See the module
 * comment for why there is exactly one failure value.
 */
export const authenticateFeedOwner = async (
  userId: number,
  token: string
): Promise<{ id: number } | null> => {
  if (!feedsEnabled() || !FEED_TOKEN_SHAPE.test(token)) return null;

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, disabled: true, feedTokenEpoch: true }
  });
  if (!owner || owner.disabled) return null;

  return feedTokenMatches(
    deriveFeedToken(owner.id, owner.feedTokenEpoch),
    token
  )
    ? { id: owner.id }
    : null;
};

const feedUrl = (name: MemberFeedName, userId: number, token: string) =>
  `${email.siteUrl}/api/feeds/${name}.xml?user=${userId}&token=${token}`;

const toMemberFeeds = (userId: number, epoch: number): MemberFeeds => {
  if (!feedsEnabled()) return { enabled: false };
  const token = deriveFeedToken(userId, epoch);
  const urls = Object.fromEntries(
    MEMBER_FEEDS.map((name) => [name, feedUrl(name, userId, token)])
  ) as Record<MemberFeedName, string>;
  return { enabled: true, feeds: urls };
};

/** A member's own feed URLs, or that feeds are not enabled on this site. */
export const getMemberFeeds = async (userId: number): Promise<MemberFeeds> => {
  const { feedTokenEpoch } = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { feedTokenEpoch: true }
  });
  return toMemberFeeds(userId, feedTokenEpoch);
};

export interface RotateFeedTokenInput {
  /** Staff only: why, for the audit row. */
  reason?: string;
  /** Staff only: sent to the member as a System PM once the rotation commits. */
  message?: string;
}

/**
 * Revoke every feed URL a member has handed out, by bumping their epoch. Used
 * by the member themselves and by staff holding `users_edit_reset_feeds`.
 *
 * An increment, not an absolute write, so two concurrent rotations both
 * revoke rather than one silently undoing the other. `updateMany` rather than
 * `update` so a missing member is a counted zero and a 404, never a P2025 500.
 */
export const rotateFeedToken = async (
  actorId: number,
  userId: number,
  { reason, message }: RotateFeedTokenInput = {}
): Promise<MemberFeeds> => {
  const epoch = await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: userId },
      data: { feedTokenEpoch: { increment: 1 } }
    });
    if (count === 0) throw new AppError(404, 'User not found');

    const { feedTokenEpoch } = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { feedTokenEpoch: true }
    });
    await audit(tx, actorId, 'user.feed_token_rotated', 'User', userId, {
      self: actorId === userId,
      ...(reason !== undefined && { reason }),
      messaged: message !== undefined
    });
    return feedTokenEpoch;
  });

  if (message !== undefined) {
    await sendSystemMessage(
      userId,
      'Your feed URLs have been reset',
      `${message}\n\nYour old feed URLs no longer work. Your new ones are in your settings. ` +
        `If you have questions, contact staff through Staff PM: ${site.staffPmPath}`
    ).catch((err) =>
      log.error('Feed token rotation PM failed', { userId, err })
    );
  }

  return toMemberFeeds(userId, epoch);
};
