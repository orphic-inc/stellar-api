import type { Prisma } from '@prisma/client';

/**
 * The author identity every PostBox-rendering surface needs — forum
 * posts/topics, comments, blog-post comments, PMs, staff inbox — so the donor
 * sign and warning sign follow the user site-wide rather than only on the
 * profile page (#231). Select via `authorRefSelect`; shape the raw row with
 * `toAuthorRef` (or `toAuthorRefOrNull` for a nullable relation, e.g. a
 * system PM with no sender) before sending it in a response.
 */
export const authorRefSelect = {
  id: true,
  username: true,
  avatar: true,
  isDonor: true,
  warned: true,
  donorRank: {
    select: {
      expiresAt: true,
      donorRank: { select: { name: true, badge: true, color: true } }
    }
  }
} satisfies Prisma.UserSelect;

export type AuthorRefRow = Prisma.UserGetPayload<{
  select: typeof authorRefSelect;
}>;

export type AuthorRef = {
  id: number;
  username: string;
  avatar: string | null;
  isDonor: boolean;
  donorRank: { name: string; badge: string; color: string } | null;
  warned: string | null;
};

// Mirrors the expiry rule in profile.ts's buildDonorPresentation: an expired
// grant renders as no donor rank, even if the hourly sweep hasn't cleared
// isDonor/donorRank yet.
export const toAuthorRef = (user: AuthorRefRow): AuthorRef => {
  const grant = user.donorRank;
  const activeRank =
    grant && (grant.expiresAt === null || grant.expiresAt > new Date())
      ? grant.donorRank
      : null;

  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    isDonor: user.isDonor,
    donorRank: activeRank,
    warned: user.warned?.toISOString() ?? null
  };
};

export const toAuthorRefOrNull = (
  user: AuthorRefRow | null | undefined
): AuthorRef | null => (user ? toAuthorRef(user) : null);
