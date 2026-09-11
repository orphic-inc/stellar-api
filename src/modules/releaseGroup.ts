import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import {
  assertCommunityAccess,
  releaseVisibleToViewer
} from './communityAccess';
import { assertArtistLive } from './artist';
import { releaseCreditsSelect, withPrimaryArtist } from './releaseCredits';
import { audit } from '../lib/audit';
import { translatePrismaError } from '../lib/prismaErrors';

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

// ─── The release-facing projection (ADR-0037 §3) ─────────────────────────────
//
// Every surface that shows a release beside its group presents the group the
// same way, from this one fragment: the release detail read, the search
// annotation, and the collage entry list. One expression rather than three
// agreeing ones — the ADR-0036 §2 lesson applied to a projection instead of a
// predicate. The failure mode is milder here, a label that drifts rather than a
// leak, but the cure costs the same.
//
// It carries IDENTITY ONLY and needs no access check of its own. A viewer who
// can see the release is already entitled to its group's identity, because
// `resolveGroupForViewer` would hand them exactly these fields for any group
// they can see one member of. The SIBLING LIST is the half that stays behind
// that resolver, and it is deliberately not here.
export const groupProjectionSelect = {
  id: true,
  title: true,
  year: true,
  artist: groupArtistSelect,
  // The oldest cover is the canonical one (ADR-0037 §3). `CoverArt` carries no
  // primary flag, so this is a read-time convention rather than curation, and
  // it reuses `listGroupCovers`'s ordering rather than inventing a second one.
  coverArt: {
    select: { image: true },
    orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
    take: 1
  }
} satisfies Prisma.ReleaseGroupSelect;

export type GroupProjection = ReturnType<typeof toGroupIdentity> & {
  image: string | null;
};

/**
 * Nothing in, `null` out — an ungrouped release has no group to present, and
 * `Release.releaseGroupId` is nullable and never backfilled (ADR-0023), so that
 * is the common case rather than the exception.
 *
 * `undefined` is accepted as well as `null`, and the two mean different things:
 * `null` is Prisma answering "this release has no group", `undefined` is a
 * caller that did not select the relation at all. Both have the same right
 * answer here, and testing only for `null` turned the second into a 500.
 */
export const toGroupProjection = (
  group:
    | Prisma.ReleaseGroupGetPayload<{ select: typeof groupProjectionSelect }>
    | null
    | undefined
): GroupProjection | null =>
  group == null
    ? null
    : { ...toGroupIdentity(group), image: group.coverArt[0]?.image ?? null };

/**
 * One entry absorbed into another under the same group (ADR-0037 §2).
 *
 * Enough to address the row — `id` for reorder, `releaseId` for delete — and to
 * say who put it there, because delete permission is per row: the collage
 * owner, THAT entry's adder, or staff. Two entries that collapse into one can
 * have two different adders, which is why nothing is dropped.
 *
 * `user` beside `userId` so a collapsed row can NAME the adder it is blocked by
 * (#617), not merely count them. `CollageEntry` carries both and the detail row
 * already renders `added by {user.username}` for the representative; without
 * this the same line could name one adder and not the other. It is no wider a
 * disclosure than that: `groupedWith` is built only from rows this viewer may
 * already see.
 */
export type AbsorbedEntry = {
  id: number;
  releaseId: number;
  communityId: number | null;
  title: string;
  userId: number;
  user: { id: number; username: string };
  addedAt: Date;
};

type CollapsibleEntry = {
  id: number;
  releaseId: number;
  userId: number;
  // REQUIRED, so a caller cannot collapse entries it did not select the adder
  // for and silently emit a `groupedWith` that cannot name anyone (#617).
  user: { id: number; username: string };
  addedAt: Date;
  release: {
    id: number;
    title: string;
    communityId: number | null;
    releaseGroup: Prisma.ReleaseGroupGetPayload<{
      select: typeof groupProjectionSelect;
    }> | null;
  };
};

/**
 * Collapse entries sharing a release group onto their first occurrence
 * (ADR-0037 §2).
 *
 * **The input MUST already be filtered to what this viewer may see.** This
 * function applies no access rule of its own and cannot: it never queries. Its
 * safety is entirely inherited from its caller passing the rows
 * `releaseVisibleToViewer` returned. Hand it a wider set and `groupedWith`
 * becomes a leak — it would name releases, communities and titles the viewer
 * has no access to — and no test here would fail. That is the one thing to
 * check before reusing this anywhere.
 *
 * Order is preserved and nothing is dropped. The first entry of a group in the
 * input order represents it, which makes the caller's `[{sort},{id}]` ordering
 * the thing that decides the representative (#613 — before that tiebreak the
 * choice was not deterministic at all). An ungrouped entry is always its own
 * row: `releaseGroupId` is nullable and never backfilled, so that is the common
 * case, and collapsing on a null group would fold the whole collage into one
 * row for exactly the reason `distinct` is unusable here.
 *
 * The raw `releaseGroup` relation is stripped from every returned release, so
 * the projection is the only shape of the group that reaches a response.
 */
export const collapseByGroup = <E extends CollapsibleEntry>(entries: E[]) => {
  const representativeOf = new Map<number, number>();
  const out: Array<
    Omit<E, 'release'> & {
      release: Omit<E['release'], 'releaseGroup'>;
      group: GroupProjection | null;
      groupedWith: AbsorbedEntry[];
    }
  > = [];

  for (const entry of entries) {
    const { releaseGroup, ...release } = entry.release;
    const groupId = releaseGroup?.id ?? null;
    const seenAt = groupId === null ? undefined : representativeOf.get(groupId);

    if (seenAt !== undefined) {
      out[seenAt].groupedWith.push({
        id: entry.id,
        releaseId: entry.releaseId,
        communityId: release.communityId,
        title: release.title,
        userId: entry.userId,
        user: entry.user,
        addedAt: entry.addedAt
      });
      continue;
    }

    if (groupId !== null) representativeOf.set(groupId, out.length);
    out.push({
      // `release` below overrides the one this spread carries, so the raw
      // relation cannot survive into the response — asserted by the "never
      // emits the raw releaseGroup relation" spec rather than trusted.
      ...entry,
      // The cast is confined to this one property. Destructuring a
      // generic-constrained field narrows to the CONSTRAINT's shape, so TS sees
      // `CollapsibleEntry['release']` here and loses whatever extra columns the
      // caller selected — `image`, `releaseType`, `credits`. The runtime value
      // is exactly `Omit<E['release'], 'releaseGroup'>`, which is what the two
      // rests above construct.
      release: release as Omit<E['release'], 'releaseGroup'>,
      group: toGroupProjection(releaseGroup),
      groupedWith: []
    });
  }

  return out;
};

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
 * Search groups, where the GROUP is the row (ADR-0037 §4).
 *
 * `/search/releases` cannot honestly dedup: it paginates with `skip`/`take`, so
 * collapsing a fetched page would leave `total` overstating and a group whose
 * members straddle a page boundary appearing twice. `distinct` cannot do it
 * either — `releaseGroupId` is nullable and Postgres groups NULLs together, so
 * it collapses every ungrouped release into one row (measured: 1 row for 101
 * releases). Here the count is true because it counts groups.
 *
 * **The filter appears twice, and the two occurrences mean different things.**
 * In the `where` it is filters ∧ visibility, deciding which GROUPS match. In
 * the members `where` it is visibility alone, deciding which MEMBERS come back
 * — so a group found by a 2001 release still shows the viewer every version of
 * that album they can reach, which is the question they were asking. This
 * mirrors `resolveGroupForViewer`, where the same doubling is the difference
 * between a filtered read and a group with every member attached.
 *
 * Only grouped releases appear here at all, which is honest for an endpoint
 * named for groups: `releaseGroupId` is never backfilled, so a catalogue with
 * no curation returns nothing and `/search/releases` remains the complete list.
 */
export const searchReleaseGroups = async (input: {
  viewerId: number;
  releaseWhere: Prisma.ReleaseWhereInput;
  skip: number;
  take: number;
  orderBy: 'title' | 'year' | 'createdAt';
  order: 'asc' | 'desc';
}) => {
  const visible = releaseVisibleToViewer(input.viewerId);
  const matching: Prisma.ReleaseWhereInput = {
    AND: [input.releaseWhere, visible]
  };
  const where: Prisma.ReleaseGroupWhereInput = {
    releases: { some: matching }
  };

  const [data, total] = await Promise.all([
    prisma.releaseGroup.findMany({
      where,
      include: {
        artist: groupArtistSelect,
        coverArt: {
          select: { image: true },
          orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
          take: 1
        },
        releases: {
          where: visible,
          select: memberReleaseSelect,
          orderBy: [{ year: 'asc' }, { id: 'asc' }]
        }
      },
      orderBy: [{ [input.orderBy]: input.order }, { id: 'asc' }],
      skip: input.skip,
      take: input.take
    }),
    prisma.releaseGroup.count({ where })
  ]);

  return {
    data: data.map((group) => ({
      ...toGroupIdentity(group),
      image: group.coverArt[0]?.image ?? null,
      releases: group.releases.map(withPrimaryArtist)
    })),
    total
  };
};

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

// ─── Curation verbs (#265 PR2) ───────────────────────────────────────────────
//
// Merge, split and retitle all move releases between identities, and all three
// require `contributions_manage` at the route. They also inherit PR1's read
// boundary rather than inventing a moderation one: an actor may only act on a
// group `resolveGroupForViewer` resolves for them. That keeps the leak surface
// at exactly one function — there is still no permission-aware community read
// anywhere in this codebase.

/** One log line on a group. `userId` null means the system wrote it. */
const logGroupEvent = (
  tx: Prisma.TransactionClient,
  releaseGroupId: number,
  actorId: number | null,
  info: string
) =>
  tx.groupLog.create({
    data: { releaseGroupId, userId: actorId, info }
  });

/**
 * Move the source group's covers onto the target.
 *
 * `CoverArt` is unique on `[releaseGroupId, image]`, so a cover the target
 * already carries would violate that constraint on repoint and abort the whole
 * transaction. Two groups being merged are, by definition, likely to share
 * artwork — so the duplicate is dropped rather than letting a merge fail on a
 * picture.
 */
const repointCovers = async (
  tx: Prisma.TransactionClient,
  sourceId: number,
  targetId: number
) => {
  const existing = await tx.coverArt.findMany({
    where: { releaseGroupId: targetId },
    select: { image: true }
  });
  await tx.coverArt.deleteMany({
    where: {
      releaseGroupId: sourceId,
      image: { in: existing.map((cover) => cover.image) }
    }
  });
  await tx.coverArt.updateMany({
    where: { releaseGroupId: sourceId },
    data: { releaseGroupId: targetId }
  });
};

/**
 * Fold `sourceId` into `targetId`. **There is no undo** — the group log is the
 * record, and a two-step confirmation belongs in the UI rather than here.
 *
 * Both groups must resolve for the actor. Merge is destructive and
 * cross-community by nature, so it reuses the same resolver every read uses
 * instead of a moderator bypass; a `contributions_manage` holder still cannot
 * reach a group whose every member sits in a community they cannot see.
 *
 * A consequence worth stating: you cannot merge INTO a memberless group,
 * because a memberless group resolves for nobody. Rename that group instead —
 * which is what you actually meant.
 *
 * Order inside the transaction is load-bearing. The source's log rows are
 * repointed **before** the source is deleted: `GroupLog.releaseGroupId`
 * cascades, so deleting first would destroy exactly the history this verb
 * exists to preserve.
 */
export const mergeReleaseGroups = async (input: {
  actorId: number;
  targetId: number;
  sourceId: number;
}) => {
  if (input.targetId === input.sourceId) {
    throw new AppError(400, 'A group cannot be merged into itself');
  }

  const target = await resolveGroupForViewer(input.targetId, input.actorId);
  const source = await resolveGroupForViewer(input.sourceId, input.actorId);

  return prisma.$transaction(async (tx) => {
    const moved = await tx.release.updateMany({
      where: { releaseGroupId: input.sourceId },
      data: { releaseGroupId: input.targetId }
    });

    await repointCovers(tx, input.sourceId, input.targetId);

    // Before the delete — see the doc comment.
    await tx.groupLog.updateMany({
      where: { releaseGroupId: input.sourceId },
      data: { releaseGroupId: input.targetId }
    });

    await logGroupEvent(
      tx,
      input.targetId,
      input.actorId,
      `Merged "${source.title}" (#${input.sourceId}) into this group. ` +
        `${moved.count} release(s) moved; that group's history is preserved above.`
    );

    await tx.releaseGroup.delete({ where: { id: input.sourceId } });

    await audit(
      tx,
      input.actorId,
      'release_group.merge',
      'ReleaseGroup',
      input.targetId,
      {
        sourceId: input.sourceId,
        sourceTitle: source.title,
        movedReleases: moved.count
      }
    );

    return {
      id: target.id,
      title: target.title,
      mergedFrom: input.sourceId,
      movedReleases: moved.count
    };
  });
};

/**
 * Move selected releases out of `groupId` and into the identity described by
 * `title`/`artistId`/`year`, creating that identity only if it does not exist.
 *
 * Split takes an identity rather than minting an anonymous "new group": the
 * derived-title alternative is almost always wrong, because the release being
 * split out is the one that was mis-grouped in the first place. Reusing
 * `createReleaseGroup` also means split can move releases into an EXISTING
 * group, which is the more common intent.
 *
 * Only the source must resolve for the actor. The target legitimately may not:
 * a freshly created identity has no members yet, so it resolves for nobody.
 *
 * An emptied source group is left in place rather than deleted. A memberless
 * group is not an anomaly here — `POST /release-groups` creates one on purpose
 * — so deleting it on this path only would be an inconsistency, and it would
 * take that group's log down with it.
 */
export const splitReleaseGroup = async (input: {
  actorId: number;
  groupId: number;
  releaseIds: number[];
  title: string;
  artistId?: number | null;
  year?: number | null;
}) => {
  const source = await resolveGroupForViewer(input.groupId, input.actorId);

  const { group: target } = await createReleaseGroup({
    title: input.title,
    artistId: input.artistId,
    year: input.year
  });

  if (target.id === input.groupId) {
    throw new AppError(400, 'That identity is the group being split');
  }

  return prisma.$transaction(async (tx) => {
    // Scoped to the source group, so a release id from anywhere else is simply
    // not matched rather than being quietly re-grouped.
    const moved = await tx.release.updateMany({
      where: { id: { in: input.releaseIds }, releaseGroupId: input.groupId },
      data: { releaseGroupId: target.id }
    });

    if (moved.count === 0) {
      throw new AppError(400, 'None of those releases belong to this group');
    }

    await logGroupEvent(
      tx,
      input.groupId,
      input.actorId,
      `Split ${moved.count} release(s) out to "${target.title}" (#${target.id}).`
    );
    await logGroupEvent(
      tx,
      target.id,
      input.actorId,
      `Received ${moved.count} release(s) split from "${source.title}" (#${input.groupId}).`
    );

    await audit(
      tx,
      input.actorId,
      'release_group.split',
      'ReleaseGroup',
      input.groupId,
      {
        targetId: target.id,
        movedReleases: moved.count
      }
    );

    return { id: target.id, title: target.title, movedReleases: moved.count };
  });
};

/**
 * Change a group's canonical identity.
 *
 * Recomputing `identityKey` can land on an identity another group already
 * holds, and that is structurally a merge — two identities becoming one. This
 * **refuses with 409 and names the other group** rather than folding into it:
 * a PUT that silently destroys a row, with no undo, is more power than an edit
 * form should carry. The caller can then choose `merge` deliberately.
 */
export const updateGroupIdentity = async (input: {
  actorId: number;
  groupId: number;
  title: string;
  artistId?: number | null;
  year?: number | null;
}) => {
  const current = await resolveGroupForViewer(input.groupId, input.actorId);

  if (input.artistId != null) {
    await assertArtistLive(input.artistId, [
      400,
      'No live artist with that id'
    ]);
  }

  const identityKey = identityKeyFor(input);
  const clash = await prisma.releaseGroup.findUnique({
    where: { identityKey },
    select: { id: true }
  });
  if (clash && clash.id !== input.groupId) {
    throw new AppError(
      409,
      `That identity already belongs to release group #${clash.id}. ` +
        'Merge this group into it instead of renaming onto it.'
    );
  }

  // `current` carries the artist as an object, not an id — recompute from its
  // parts rather than spreading it, or a group that cites an artist compares
  // against a key built with `artistId: null` and every edit looks like a
  // change.
  const currentKey = identityKeyFor({
    title: current.title,
    artistId: current.artist?.id ?? null,
    year: current.year
  });
  if (identityKey === currentKey) {
    return {
      id: current.id,
      title: current.title,
      artist: current.artist,
      year: current.year
    };
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.releaseGroup.update({
      where: { id: input.groupId },
      data: { ...identityColumns(input), identityKey },
      include: { artist: groupArtistSelect }
    });
    await logGroupEvent(
      tx,
      input.groupId,
      input.actorId,
      `Identity changed from "${current.title}" to "${updated.title}".`
    );
    return toGroupIdentity(updated);
  });
};

const coverSelect = {
  id: true,
  image: true,
  summary: true,
  userId: true,
  addedAt: true,
  user: { select: { id: true, username: true } }
} as const;

/**
 * Covers, like everything else here, are reachable only through the resolver:
 * seeing a group's cover art means being able to see the group.
 */
export const listGroupCovers = async (
  groupId: number,
  viewerId: number,
  page: { skip: number; limit: number }
) => {
  await resolveGroupForViewer(groupId, viewerId);
  const where = { releaseGroupId: groupId };
  const [data, total] = await Promise.all([
    prisma.coverArt.findMany({
      where,
      select: coverSelect,
      orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
      skip: page.skip,
      take: page.limit
    }),
    prisma.coverArt.count({ where })
  ]);
  return { data, total };
};

/** Adding a cover needs no permission beyond reaching the group — it is
 *  curation, like attaching a release. Removing someone else's does. */
export const addGroupCover = async (input: {
  actorId: number;
  groupId: number;
  image: string;
  summary?: string | null;
}) => {
  await resolveGroupForViewer(input.groupId, input.actorId);

  return prisma.$transaction(async (tx) => {
    let cover;
    try {
      cover = await tx.coverArt.create({
        data: {
          releaseGroupId: input.groupId,
          image: input.image,
          summary: input.summary ?? null,
          userId: input.actorId
        },
        select: coverSelect
      });
    } catch (err) {
      translatePrismaError(err, {
        P2002: [409, 'This group already carries that cover'],
        P2003: [404, 'Release group not found']
      });
    }
    await logGroupEvent(
      tx,
      input.groupId,
      input.actorId,
      `Added a cover: ${input.image}`
    );
    return cover;
  });
};

/**
 * Remove a cover. The adder may remove their own; removing anyone else's needs
 * `contributions_manage`, which the route resolves and passes in — the module
 * takes the decision, not the permission map, so the rule is testable without
 * a request.
 */
export const removeGroupCover = async (input: {
  actorId: number;
  groupId: number;
  coverId: number;
  canModerate: boolean;
}) => {
  await resolveGroupForViewer(input.groupId, input.actorId);

  const cover = await prisma.coverArt.findFirst({
    where: { id: input.coverId, releaseGroupId: input.groupId },
    select: { id: true, userId: true, image: true }
  });
  if (!cover) throw new AppError(404, 'Cover not found');

  if (cover.userId !== input.actorId && !input.canModerate) {
    throw new AppError(
      403,
      'Only the member who added this cover may remove it'
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.coverArt.delete({ where: { id: cover.id } });
    await logGroupEvent(
      tx,
      input.groupId,
      input.actorId,
      `Removed a cover: ${cover.image}`
    );
  });
};

/**
 * The group's identity history.
 *
 * `hidden` rows are staff-only. **Nothing writes one yet** — no verb in this
 * module sets `hidden: true` — so today the filter is a guard against a future
 * writer rather than a live distinction. It is enforced now precisely so that
 * whoever adds the first hidden row does not also have to remember to add the
 * filter.
 */
export const listGroupLog = async (
  groupId: number,
  viewerId: number,
  canSeeHidden: boolean,
  page: { skip: number; limit: number }
) => {
  await resolveGroupForViewer(groupId, viewerId);
  const where = {
    releaseGroupId: groupId,
    ...(canSeeHidden ? {} : { hidden: false })
  };
  const [data, total] = await Promise.all([
    prisma.groupLog.findMany({
      where,
      select: {
        id: true,
        info: true,
        hidden: true,
        loggedAt: true,
        user: { select: { id: true, username: true } }
      },
      orderBy: [{ loggedAt: 'desc' }, { id: 'desc' }],
      skip: page.skip,
      take: page.limit
    }),
    prisma.groupLog.count({ where })
  ]);
  return { data, total };
};
