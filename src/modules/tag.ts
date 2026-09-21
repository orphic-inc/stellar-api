import { prisma } from '../lib/prisma';

export const resolveTagName = async (name: string): Promise<string> => {
  const alias = await prisma.tagAlias.findUnique({
    where: { badTag: name },
    select: { goodTag: { select: { name: true } } }
  });
  return alias?.goodTag.name ?? name;
};

export const resolveTagNames = async (names: string[]): Promise<string[]> => {
  if (names.length === 0) return [];
  const aliases = await prisma.tagAlias.findMany({
    where: { badTag: { in: names } },
    select: { badTag: true, goodTag: { select: { name: true } } }
  });
  const aliasMap = new Map(aliases.map((a) => [a.badTag, a.goodTag.name]));
  return [...new Set(names.map((n) => aliasMap.get(n) ?? n))];
};

/**
 * The curated vocabulary (#298, ADR-0045).
 *
 * `isOfficial` ANNOTATES AN OPEN VOCABULARY. Members keep minting tags freely —
 * `contribution.ts` and `releaseWorkbench/tags.ts` both upsert whatever arrives —
 * and nothing here closes that. What curation adds is a canonical set worth
 * offering, so a member reaches for `shoegaze` instead of inventing `shoe.gaze`.
 *
 * WHY THIS IS NOT `occurrences`. Popularity ranks; curation selects. A tag can be
 * popular and useless ("awesome") or rare and canonical ("shoegaze"), so the two
 * are independent and neither derives the other.
 */

/**
 * Fold a name before it enters the curated set.
 *
 * ONLY THE PROMOTE PATH CALLS THIS, deliberately. Tag names are unnormalized
 * site-wide — `Tag.name` is case-sensitive in Postgres and `normalizeTags` in
 * `contribution.ts` only splits and trims — so `rock` and `Rock` are two rows
 * today. Folding here stops the CURATED set from holding both, which is the one
 * place the inconsistency is least excusable; folding the member write paths as
 * well needs a migration to merge existing case-variant rows and their
 * `ReleaseTag`/`ArtistTag` children, and is its own issue.
 */
export const foldTagName = (name: string): string => name.trim().toLowerCase();

/**
 * Promote a tag to the curated vocabulary, creating it when absent.
 *
 * PROMOTION MINTS, and that is what makes this a vocabulary rather than an
 * endorsement of whatever members happened to invent: on a fresh install there
 * are no tags at all, so a curator who could only flip existing rows would have
 * nothing to curate. A minted tag starts at `occurrences: 0`, which keeps it out
 * of `getTopTags`'s `occurrences > 0` filter until a release actually carries it.
 *
 * The name is folded, then run through the alias table, so promoting a name that
 * is aliased away promotes the good tag instead. The caller gets the row back and
 * can tell the curator which name it landed on.
 *
 * NO P2002 GUARD, AND THAT IS CHECKED RATHER THAN ASSUMED. An `upsert` on a
 * unique field is the classic concurrent-insert race, but this one has a single
 * unique in its `where`, no nested writes and a scalar update, so Prisma compiles
 * it to a native INSERT ... ON CONFLICT DO UPDATE. Two curators promoting the
 * same new name at once both succeed. Add nothing here unless that stops being
 * true.
 */
export const promoteTag = async (name: string) => {
  const resolved = await resolveTagName(foldTagName(name));
  const tag = await prisma.tag.upsert({
    where: { name: resolved },
    create: { name: resolved, occurrences: 0, isOfficial: true },
    update: { isOfficial: true },
    select: { id: true, name: true, occurrences: true, isOfficial: true }
  });
  return tag;
};

/** Demote a tag out of the curated vocabulary. The row itself is never deleted. */
export const demoteTag = (id: number) =>
  prisma.tag.update({
    where: { id },
    data: { isOfficial: false },
    select: { id: true, name: true, occurrences: true, isOfficial: true }
  });

/**
 * The whole curated set, name-sorted and unpaginated.
 *
 * UNPAGINATED ON PURPOSE. This is the member-facing read behind a tag picker, and
 * a vocabulary is conceptually one thing — a picker that had to loop over
 * `meta.totalPages` to assemble it would be assembling something the curator
 * thinks of as a single list. It is bounded by staff action rather than by member
 * activity, which is what makes that safe; `listTags` is the paginated read over
 * the unbounded table.
 */
export const listOfficialTags = () =>
  prisma.tag.findMany({
    where: { isOfficial: true },
    // Array form with an id tiebreak (#613). `Tag.name` is unique so nothing can
    // actually tie, but the guard derives its exemptions across every model
    // holding a column of that name, and `name` is free on most of them.
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, occurrences: true, isOfficial: true }
  });

/** The paginated read over every tag — the curation surface's own list. */
export const listTags = async (opts: {
  q?: string;
  skip: number;
  limit: number;
}) => {
  const where = opts.q
    ? { name: { contains: foldTagName(opts.q), mode: 'insensitive' as const } }
    : {};
  return Promise.all([
    prisma.tag.findMany({
      where,
      orderBy: [{ isOfficial: 'desc' }, { name: 'asc' }],
      skip: opts.skip,
      take: opts.limit,
      select: { id: true, name: true, occurrences: true, isOfficial: true }
    }),
    prisma.tag.count({ where })
  ]);
};

/**
 * Is this name already curated? The guard `tagAliases` uses before aliasing a
 * name away — see ADR-0045 on why that direction is refused rather than resolved.
 */
export const isOfficialTagName = async (name: string): Promise<boolean> => {
  const tag = await prisma.tag.findUnique({
    where: { name: foldTagName(name) },
    select: { isOfficial: true }
  });
  return tag?.isOfficial ?? false;
};
