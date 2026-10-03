/**
 * The `validate:handles` gate (#234): counts the reads that bypass a validator
 * handle, per file, against a baseline that only shrinks.
 *
 * A route reads what its validator parsed through `handle.read(res)`, typed
 * from the schema and checked against what the route mounted. The old reads
 * pick their type by hand and read `res.locals` blind. They stay legal while
 * the sweep converts them file by file, and this keeps a new one out.
 *
 * Pure: the CLI in scripts/ feeds it the source text.
 */

/** A call to an unchecked reader, or a direct read of what it reads. */
const BYPASS =
  /\bparsed(?:Body|Query|Params|Page)\s*[<(]|\bres\.locals\.parsed(?:Body|Query|Params)\b/g;

/** Where the old readers are defined, so not counted. */
export const DEFINING_FILES = ['middleware/validate.ts', 'lib/pagination.ts'];

export type Counts = Record<string, number>;

/** Bypass reads in one file's source, skipping comment lines. */
export const countBypasses = (source: string): number =>
  source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .reduce((n, line) => n + (line.match(BYPASS)?.length ?? 0), 0);

export type HandlesResult = {
  ok: boolean;
  /** Files with more bypasses than the baseline allows. */
  grown: Array<{ file: string; count: number; allowed: number }>;
  /** Files with fewer than the baseline, whose entry must come down. */
  stale: Array<{ file: string; count: number; allowed: number }>;
};

export const checkValidateHandles = (
  counts: Counts,
  baseline: Counts
): HandlesResult => {
  const files = new Set([...Object.keys(counts), ...Object.keys(baseline)]);
  const grown: HandlesResult['grown'] = [];
  const stale: HandlesResult['stale'] = [];
  for (const file of [...files].sort()) {
    const count = counts[file] ?? 0;
    const allowed = baseline[file] ?? 0;
    if (count > allowed) grown.push({ file, count, allowed });
    else if (count < allowed) stale.push({ file, count, allowed });
  }
  return { ok: grown.length === 0 && stale.length === 0, grown, stale };
};

export const formatHandlesReport = (
  counts: Counts,
  result: HandlesResult
): string => {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const files = Object.values(counts).filter((n) => n > 0).length;
  const lines = [
    `${total} unchecked validator reads in ${files} files (#234).`
  ];
  for (const { file, count, allowed } of result.grown) {
    lines.push(
      `  GROWN  ${file}: ${count} (baseline ${allowed}). Read through the ` +
        "validator's handle: `const x = someParams.read(res)`; paginate with " +
        '`pageOf(query.read(res))`.'
    );
  }
  for (const { file, count, allowed } of result.stale) {
    lines.push(
      `  STALE  ${file}: ${count} (baseline ${allowed}). Lower its entry, or ` +
        'regenerate with `npm run validate:handles -- --write-baseline`.'
    );
  }
  return lines.join('\n');
};
