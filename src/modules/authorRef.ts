import type { Prisma } from '@prisma/client';
import { activeWarnedAt } from './standing';

/**
 * The author identity every PostBox-rendering surface needs — forum
 * posts/topics, comments, blog-post comments, PMs, staff inbox — so the donor
 * sign and warning sign follow the user site-wide rather than only on the
 * profile page (#231). Select via `authorRefSelect`; shape the raw row with
 * `toAuthorRef` (or `toAuthorRefOrNull` for a nullable relation, e.g. a
 * system PM with no sender) before sending it in a response.
 */

/** A member's donor grant, with the expiry `activeDonorRank` needs. */
export const donorRankSelect = {
  select: {
    expiresAt: true,
    donorRank: { select: { name: true, badge: true, color: true } }
  }
} satisfies Prisma.User$donorRankArgs;

export const authorRefSelect = {
  id: true,
  username: true,
  avatar: true,
  isDonor: true,
  // The rows rather than `User.warned`, which outlives expiry (#719). A
  // member's warnings are few, so the whole set is filtered in toAuthorRef.
  warnings: { select: { createdAt: true, expiresAt: true } },
  donorRank: donorRankSelect
} satisfies Prisma.UserSelect;

export type AuthorRefRow = Prisma.UserGetPayload<{
  select: typeof authorRefSelect;
}>;

export type DonorRankRef = { name: string; badge: string; color: string };

export type AuthorRef = {
  id: number;
  username: string;
  avatar: string | null;
  isDonor: boolean;
  donorRank: DonorRankRef | null;
  warned: string | null;
};

// Mirrors the expiry rule in profile.ts's buildDonorPresentation: an expired
// grant renders as no donor rank, even if the hourly sweep hasn't cleared
// isDonor/donorRank yet.
export const activeDonorRank = (
  grant: AuthorRefRow['donorRank'],
  now: Date
): DonorRankRef | null =>
  grant && (grant.expiresAt === null || grant.expiresAt > now)
    ? grant.donorRank
    : null;

export const toAuthorRef = (user: AuthorRefRow): AuthorRef => {
  const now = new Date();
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    isDonor: user.isDonor,
    donorRank: activeDonorRank(user.donorRank, now),
    warned: activeWarnedAt(user.warnings, now)?.toISOString() ?? null
  };
};

export const toAuthorRefOrNull = (
  user: AuthorRefRow | null | undefined
): AuthorRef | null => (user ? toAuthorRef(user) : null);
