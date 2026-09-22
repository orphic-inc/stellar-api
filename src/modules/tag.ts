import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

/**
 * The one form a tag name takes (#689, ADR-0047).
 *
 * Lowercase; a run of spaces, tabs, `-` or `_` becomes one `.`; anything else
 * outside `[a-z0-9.]` is dropped; repeated dots collapse and edge dots go. So
 * `Hip Hop`, `hip-hop` and `hip_hop` are all `hip.hop`, and `Drum & Bass` is
 * `drum.bass`. This is the legacy character set, except that a separator becomes
 * a dot where the legacy rule deleted it.
 *
 * ASCII ONLY, ON PURPOSE. A full Unicode lowercase turns some non-ASCII letters
 * into ASCII ones (the Kelvin sign into `k`), and Postgres' `lower()` follows the
 * database locale. The migration that merged the existing variants restates this
 * rule in SQL, and its integration test checks the two agree; keeping both inside
 * ASCII is what makes that agreement independent of where either one runs.
 *
 * A name can normalize to the empty string. Callers decide what that means:
 * `resolveTagNames` drops it from a list, and a single-name write refuses it.
 */
export const normalizeTagName = (name: string): string =>
  name
    .replace(/[A-Z]+/g, (upper) => upper.toLowerCase())
    .replace(/[ \t\n\r\f\v_-]+/g, '.')
    .replace(/[^a-z0-9.]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '');

/** The refusal a single-name tag write gives a name that normalizes to nothing. */
export const assertUsableTagName = (name: string): void => {
  if (!name) throw new AppError(400, 'Tag name has no usable characters');
};

/**
 * Normalize, then follow an alias. Every path that takes a tag name — writes and
 * read filters alike — goes through here or `resolveTagNames`, so no path can
 * skip the rule without also skipping aliases.
 */
export const resolveTagName = async (name: string): Promise<string> => {
  const normalized = normalizeTagName(name);
  if (!normalized) return '';
  const alias = await prisma.tagAlias.findUnique({
    where: { badTag: normalized },
    select: { goodTag: { select: { name: true } } }
  });
  return alias?.goodTag.name ?? normalized;
};

/** `resolveTagName` over a list: empties are dropped, and variants dedupe. */
export const resolveTagNames = async (names: string[]): Promise<string[]> => {
  const normalized = [...new Set(names.map(normalizeTagName).filter(Boolean))];
  if (normalized.length === 0) return [];
  const aliases = await prisma.tagAlias.findMany({
    where: { badTag: { in: normalized } },
    select: { badTag: true, goodTag: { select: { name: true } } }
  });
  const aliasMap = new Map(aliases.map((a) => [a.badTag, a.goodTag.name]));
  return [...new Set(normalized.map((n) => aliasMap.get(n) ?? n))];
};

/**
 * The curated vocabulary (#298, ADR-0045).
 *
 * `isOfficial` ANNOTATES AN OPEN VOCABULARY. Members keep minting tags freely —
 * `contribution.ts` and `releaseWorkbench/tags.ts` both upsert whatever arrives,
 * once normalized — and nothing here closes that. What curation adds is a canonical set worth
 * offering, so a member reaches for `shoegaze` instead of inventing `shoe.gaze`.
 *
 * WHY THIS IS NOT `occurrences`. Popularity ranks; curation selects. A tag can be
 * popular and useless ("awesome") or rare and canonical ("shoegaze"), so the two
 * are independent and neither derives the other.
 */

/**
 * Promote a tag to the curated vocabulary, creating it when absent.
 *
 * PROMOTION MINTS, and that is what makes this a vocabulary rather than an
 * endorsement of whatever members happened to invent: on a fresh install there
 * are no tags at all, so a curator who could only flip existing rows would have
 * nothing to curate. A minted tag starts at `occurrences: 0`, which keeps it out
 * of `getTopTags`'s `occurrences > 0` filter until a release actually carries it.
 *
 * The name is normalized, then run through the alias table, so promoting a name
 * that is aliased away promotes the good tag instead. The caller gets the row
 * back and can tell the curator which name it landed on.
 *
 * NO P2002 GUARD, AND THAT IS CHECKED RATHER THAN ASSUMED. An `upsert` on a
 * unique field is the classic concurrent-insert race, but this one has a single
 * unique in its `where`, no nested writes and a scalar update, so Prisma compiles
 * it to a native INSERT ... ON CONFLICT DO UPDATE. Two curators promoting the
 * same new name at once both succeed. Add nothing here unless that stops being
 * true.
 */
export const promoteTag = async (name: string) => {
  const resolved = await resolveTagName(name);
  assertUsableTagName(resolved);
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
    ? {
        name: {
          contains: normalizeTagName(opts.q),
          mode: 'insensitive' as const
        }
      }
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
    where: { name: normalizeTagName(name) },
    select: { isOfficial: true }
  });
  return tag?.isOfficial ?? false;
};

/**
 * The checked names for an alias write — both `POST` and `PUT` take them from
 * here (#689, ADR-0047).
 *
 * `badTag` is stored NORMALIZED, because that is how the resolver looks it up;
 * stored any other way it would never match. `goodTag` is found by its
 * normalized name. An alias that normalizes onto its own target is refused:
 * normalization already does its job, and the migration deleted such rows.
 */
export const prepareTagAlias = async (input: {
  badTag: string;
  goodTag: string;
}) => {
  const badTag = normalizeTagName(input.badTag);
  assertUsableTagName(badTag);
  // An official tag may not be aliased away (#298, ADR-0045). Nothing in the
  // schema prevents it — `badTag` is a free String with no FK to `Tag` — so
  // without this, one staff action silently undoes another: the tag stays
  // marked canonical while the resolver rewrites it at every write.
  if (await isOfficialTagName(badTag)) {
    throw new AppError(
      409,
      `"${badTag}" is an official tag — demote it before aliasing it away`
    );
  }
  const goodTag = await prisma.tag.findUnique({
    where: { name: normalizeTagName(input.goodTag) }
  });
  if (!goodTag) throw new AppError(404, `Tag "${input.goodTag}" not found`);
  if (goodTag.name === badTag) {
    throw new AppError(400, `"${input.badTag}" is already the tag "${badTag}"`);
  }
  return { badTag, goodTagId: goodTag.id };
};
