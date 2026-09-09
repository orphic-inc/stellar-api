import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import {
  assertCommunityAccess,
  communityReadableWhere
} from './communityAccess';
import { assertArtistLive } from './artist';
import { releaseCreditsSelect, withPrimaryArtist } from './releaseCredits';

// ReleaseGroup — cross-community content identity (ADR-0023, #265).
//
// This module exists because a ReleaseGroup edge crosses community boundaries,
// and Releases are private to their Community. That makes every read which
// walks the edge access-control-sensitive: ADR-0023 accepts one new leak
// surface and requires it be localized to a single resolver. This is that
// resolver, and `resolveGroupForViewer` is the only way a group's members reach
// a caller.
//
// The group carries IDENTITY ONLY. Editions and rip-quality come from the
// release-scoped contributions read, not from here.

/**
 * The viewer's release scope — the one rule the whole leak surface rests on.
 *
 * This is a `where` fragment rather than a gate, and that is the point.
 * `communityAccess.ts` draws the line in its own doc comments: "A search
 * filters where a browse refuses… Making search do the same would turn every
 * query into an existence oracle for private communities." A ReleaseGroup names
 * no single community — it spans them — so resolving its members is
 * search-shaped, and `hasCommunityAccess` (which answers about one named
 * community, and throws) is the wrong tool as well as the old name.
 *
 * The `communityId: null` arm is load-bearing, for the reason
 * `routes/api/search.ts` records at its own copy: `Release.communityId` is
 * nullable and **a bare relation filter excludes a null relation**, so without
 * this arm the filter would hide rows that were never private.
 *
 * Deliberately identical to `scopedToReadableCommunities` in
 * `routes/api/search.ts`. The two are one rule with two call sites and must not
 * drift; `releaseGroup.spec.ts` asserts they agree.
 *
 * There is no staff bypass, here or anywhere below. No community-scoped release
 * read in this codebase has one, `communityAccess.ts` contains no permission
 * check at all, and adding the first one on the newest leak surface is not a
 * thing to do quietly (ADR-0023 §Implementation contract 2).
 */
export const releaseVisibleToViewer = (
  viewerId: number
): Prisma.ReleaseWhereInput => ({
  OR: [{ communityId: null }, { community: communityReadableWhere(viewerId) }]
});

export interface GroupIdentityInput {
  title: string;
  artistId?: number | null;
  year?: number | null;
}

/**
 * The normalized identity a group is unique on.
 *
 * Uniqueness lives on this derived key rather than on
 * `@@unique([title, artistId, year])` because that constraint cannot do the
 * job: Postgres treats NULLs as distinct and Prisma 6 rejects
 * `nullsNotDistinct`, so artist-less and year-less groups would still accrete —
 * as would two titles differing only in case or in internal spacing, since
 * there is no `citext` here. Duplicate-group accretion is the debt #265 exists
 * to pay down, and a constraint that catches only the easy half leaves merge
 * doing work the schema should have prevented.
 *
 * `JSON.stringify` rather than a `|` join: a title may itself contain the
 * separator ("AC|DC"), and a hand-rolled join makes two different identities
 * collide on one key. JSON escapes it for us and is deterministic for these
 * three scalar types.
 *
 * This function is the ONLY writer of `identityKey`. Nothing else may compute
 * it, or the constraint stops meaning what it says.
 */
export const identityKeyFor = (input: GroupIdentityInput): string =>
  JSON.stringify([
    input.title.trim().toLowerCase().replace(/\s+/g, ' '),
    input.artistId ?? null,
    input.year ?? null
  ]);

const groupArtistSelect = { select: { id: true, name: true } } as const;

/**
 * The group's identity as the contract exposes it.
 *
 * Written as a projection rather than returning the row so `identityKey` never
 * reaches a caller. It is a derived internal key whose only writer is
 * `identityKeyFor`; putting it in a response invites a client to compute its
 * own, and the moment one does, the normalization rules stop being ours to
 * change.
 */
const toGroupIdentity = (group: {
  id: number;
  title: string;
  year: number | null;
  artist: { id: number; name: string } | null;
}) => ({
  id: group.id,
  title: group.title,
  artist: group.artist,
  year: group.year
});

// Identity only. No contributions, no editions, no files — those are the
// release-scoped read's half of the split ADR-0023 Decision 2 describes.
const memberReleaseSelect = {
  id: true,
  title: true,
  year: true,
  image: true,
  communityId: true,
  community: { select: { id: true, name: true } },
  credits: releaseCreditsSelect
} as const;

/**
 * A group as this viewer may see it, or 404.
 *
 * The access filter appears twice on purpose. In the `where` it decides whether
 * the group resolves at all; in the `include` it decides which members come
 * back. Both are needed: the first without the second would return a group with
 * every member attached, and the second without the first would return an
 * empty-membered group to someone who should not learn it exists.
 *
 * A group with no viewer-visible member is **omitted, not rendered
 * identity-only** (ADR-0023 Decision 2, resolved on acceptance). It answers the
 * same 404 with the same message as a group id that does not exist, which is
 * what keeps this from being an existence oracle for private catalogues — the
 * two cases must stay indistinguishable from outside.
 */
export const resolveGroupForViewer = async (
  groupId: number,
  viewerId: number
) => {
  const visible = releaseVisibleToViewer(viewerId);

  const group = await prisma.releaseGroup.findFirst({
    where: { id: groupId, releases: { some: visible } },
    include: {
      artist: groupArtistSelect,
      releases: {
        where: visible,
        select: memberReleaseSelect,
        orderBy: [{ year: 'asc' }, { id: 'asc' }]
      }
    }
  });

  if (!group) throw new AppError(404, 'Release group not found');

  return {
    ...toGroupIdentity(group),
    releases: group.releases.map(withPrimaryArtist)
  };
};

/**
 * Find-or-create on the normalized identity.
 *
 * Reported as created/found so the route can answer 201 or 200 honestly. The
 * read-then-create is racy on its own, so the `P2002` arm re-reads: two callers
 * naming the same identity both end up with the same row, and the loser reports
 * `created: false` rather than failing. That is the point of putting uniqueness
 * in the database instead of in a check.
 *
 * A dangling `artistId` is a body-supplied id, so it answers **400**, matching
 * the write guards #597 added — the route itself exists, the value in the
 * payload does not. `assertArtistLive` rather than a bare foreign key because a
 * soft-deleted artist keeps a live row: the FK would resolve happily and let a
 * new group cite a withdrawn artist. (Preserving an *existing* citation is the
 * NOT FILTERED half; minting a new one is not.)
 */
const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** The projected group carrying this identity, or null. Used on both the
 *  first-look and the lost-race path, so they cannot answer differently. */
const findGroupByIdentity = async (identityKey: string) => {
  const row = await prisma.releaseGroup.findUnique({
    where: { identityKey },
    include: { artist: groupArtistSelect }
  });
  return row ? toGroupIdentity(row) : null;
};

/** The stored identity columns. Separated so the null-coalescing lives beside
 *  `identityKeyFor`'s own normalization rather than inside the create call. */
const identityColumns = (input: GroupIdentityInput) => ({
  title: input.title.trim(),
  artistId: input.artistId ?? null,
  year: input.year ?? null
});

export const createReleaseGroup = async (input: GroupIdentityInput) => {
  if (input.artistId != null) {
    await assertArtistLive(input.artistId, [
      400,
      'No live artist with that id'
    ]);
  }

  const identityKey = identityKeyFor(input);

  const existing = await findGroupByIdentity(identityKey);
  if (existing) return { group: existing, created: false };

  try {
    const created = await prisma.releaseGroup.create({
      data: { ...identityColumns(input), identityKey },
      include: { artist: groupArtistSelect }
    });
    return { group: toGroupIdentity(created), created: true };
  } catch (err) {
    // Negative control in the spec: anything that is not the unique violation
    // must still propagate.
    if (!isUniqueViolation(err)) throw err;
    // Lost the race; the other writer's row is the answer.
    const raced = await findGroupByIdentity(identityKey);
    if (!raced) throw err;
    return { group: raced, created: false };
  }
};

/**
 * Attach a release to a group, or detach it with `null`.
 *
 * This is the day-to-day curation verb, and it **refuses where the resolver
 * filters**. The route names one community in its path, so the caller asked
 * about a specific community and is owed a straight answer:
 * `assertCommunityAccess` throws 404/403. You may only group releases you can
 * already reach, which keeps an attach's blast radius inside the actor's own
 * visibility.
 *
 * The release is matched on `communityId` as well as its own id. Without that,
 * a caller with access to community A could pass a release id belonging to
 * private community B and quietly re-group it through a path that only ever
 * checked A.
 */
export const setReleaseGroup = async (input: {
  actorId: number;
  communityId: number;
  releaseId: number;
  releaseGroupId: number | null;
}) => {
  await assertCommunityAccess(input.communityId, input.actorId);

  const release = await prisma.release.findFirst({
    where: { id: input.releaseId, communityId: input.communityId },
    select: { id: true }
  });
  if (!release) throw new AppError(404, 'Release not found');

  if (input.releaseGroupId != null) {
    const group = await prisma.releaseGroup.findUnique({
      where: { id: input.releaseGroupId },
      select: { id: true }
    });
    // 400, not 404: the route exists and the release exists — it is the id in
    // the body that does not.
    if (!group) throw new AppError(400, 'No release group with that id');
  }

  const updated = await prisma.release.update({
    where: { id: input.releaseId },
    data: { releaseGroupId: input.releaseGroupId },
    select: { id: true, releaseGroupId: true }
  });

  return updated;
};
