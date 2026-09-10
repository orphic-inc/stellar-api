import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

/**
 * Every ordered read ends in a tiebreak (#613).
 *
 * `orderBy` on a non-unique column leaves the row order **unordered by
 * contract** — Postgres may return tied rows in any order, and that order can
 * change when an `UPDATE` moves a row in the heap or the planner picks a
 * different scan. Where the query also carries a `take` or a `skip`, the tie
 * stops being cosmetic and decides membership: which tags chart, which four
 * covers a collage shelf shows, whether a paginated row appears twice or not
 * at all.
 *
 * This is a drift guard rather than a CI gate, deliberately (#613). It replaces
 * no checker; it exists because the class was invisible until #605 went looking
 * for it, and a hand-derived count of the affected sites is exactly what #564's
 * lesson warns against.
 *
 * THE RULE, and why it is derived rather than listed: a literal `orderBy` must
 * use the array form unless its column is unique in every model that has one by
 * that name, or is a `DateTime` in every such model. Both sets come from the
 * DMMF, so no column list is maintained by hand — a list would reintroduce the
 * derivation problem this file exists to remove. The `DateTime` exemption is
 * what keeps the deferred `createdAt` sweep out of scope: ties on a timestamp
 * are incidental rather than structural.
 *
 * WHAT IT CANNOT SEE, and this is the important half. Three orderings are built
 * dynamically and never appear as a literal — `routes/api/search.ts`'s
 * `orderByMap`, `modules/requestLifecycle.ts`'s computed `{ [orderBy]: order }`,
 * and `modules/top10.ts`'s `orderBy` variable. All three are paginated, and all
 * three carry the tiebreak today, but nothing here would notice if one lost it.
 * Widening the rule to "every `orderBy` must be an array" would reach them, at
 * the cost of an exclusion list for the `orderBy` fields in `schemas/*.ts`,
 * which are Zod shapes rather than Prisma arguments.
 */

const SRC = 'src';
const SKIPPED_DIRS = new Set(['integration', 'test']);

const collectFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : collectFiles(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });

/** Every field in the datamodel, grouped by name across all 127 models. */
const fieldsByName = (): Map<string, Prisma.DMMF.Field[]> => {
  const map = new Map<string, Prisma.DMMF.Field[]>();
  for (const model of Prisma.dmmf.datamodel.models) {
    for (const field of model.fields) {
      const seen = map.get(field.name) ?? [];
      seen.push(field);
      map.set(field.name, seen);
    }
  }
  return map;
};

const FIELDS = fieldsByName();

/**
 * Ordering on this column is already deterministic, or is a timestamp whose
 * ties are incidental. `every`, not `some`: a name that is unique on one model
 * and free on another (`lastPost` is a `DateTime` on one and a relation on
 * another) has to be treated as the weaker case.
 */
const exempt = (column: string): boolean => {
  const fields = FIELDS.get(column);
  if (!fields) return false;
  return (
    fields.every((f) => f.isId || f.isUnique) ||
    fields.every((f) => f.type === 'DateTime')
  );
};

const LITERAL_ORDER_BY = /orderBy: \{ *([A-Za-z_][A-Za-z0-9_]*)/;

const untiedOrderings = (): string[] =>
  collectFiles(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) => {
        const match = LITERAL_ORDER_BY.exec(line);
        if (!match || exempt(match[1])) return [];
        return [`${file}:${index + 1} orders by \`${match[1]}\``];
      })
  );

describe('orderBy tiebreaks (#613)', () => {
  it('derives its exemptions from the datamodel rather than a list', () => {
    // The anchors the rule rests on. If these stop holding, every assertion
    // below starts passing for the wrong reason.
    expect(exempt('id')).toBe(true);
    expect(exempt('createdAt')).toBe(true);
    expect(exempt('sort')).toBe(false);
    expect(exempt('score')).toBe(false);
  });

  it('finds a missing tiebreak when one is removed', () => {
    // A negative control on the matcher itself, not on the codebase: the
    // assertion below reports nothing when the regex silently stops matching,
    // and a clean pass would look identical.
    const line = "      orderBy: { sort: 'asc' },";
    const match = LITERAL_ORDER_BY.exec(line);
    expect(match?.[1]).toBe('sort');
    expect(exempt('sort')).toBe(false);
  });

  it('leaves no literal ordering without a tiebreak', () => {
    expect(untiedOrderings()).toEqual([]);
  });
});
