// Pure environment-coverage checker (#682). Four surfaces name the environment
// variables, and they drifted apart three times (#653, then #737) because
// nothing compared them. No I/O here — the CLI wrapper
// (src/scripts/check-env-coverage.ts) gathers the real surfaces and feeds them
// in, the split versionConsistency.ts uses.
//
// The invariants:
//
//  1. Every variable RUNTIME code reads is in `.env.default`. Runtime means
//     `src/` without scripts, tests, integration tests and specs: those read
//     CI and e2e tooling variables an operator never sets.
//  2. Every `.env.default` variable is explained in docs/README.md's table.
//  3. Every variable AGENTS.md's table names is in `.env.default`. That table is
//     a curated subset, so it need not be complete; it must not name a variable
//     that has been retired or renamed.
//  4. Every `.env.default` variable is read SOMEWHERE — any of `src/`, or
//     Prisma's `env("…")`. A retirement otherwise leaves operators setting a
//     variable nothing reads (#630).

export interface EnvSurfaces {
  /** Variables read by runtime code. */
  runtimeReads: string[];
  /** Variables read anywhere: all of `src/` plus `schema.prisma`. */
  allReads: string[];
  /** Variables `.env.default` assigns. */
  envDefault: string[];
  /** Names docs/README.md's table lists; `PREFIX_*` is a wildcard. */
  docs: string[];
  /** Names AGENTS.md's environment table lists. */
  agents: string[];
}

export interface EnvAllowlists {
  /** Read at runtime but set by the platform, not by an operator. */
  notOperatorSet: string[];
  /** In `.env.default` but read only in a way the scan cannot see. */
  readIndirectly: string[];
}

export const DEFAULT_ALLOWLISTS: EnvAllowlists = {
  notOperatorSet: ['NODE_ENV'],
  readIndirectly: []
};

export interface EnvCoverageResult {
  ok: boolean;
  missingFromEnvDefault: string[];
  missingFromDocs: string[];
  staleInAgents: string[];
  unread: string[];
}

const sorted = (names: Iterable<string>) => [...new Set(names)].sort();

/** Whether a docs name covers `name`, exactly or as a `PREFIX_*` wildcard. */
const covers = (docName: string, name: string) =>
  docName.endsWith('*')
    ? name.startsWith(docName.slice(0, -1))
    : docName === name;

export const checkEnvCoverage = (
  s: EnvSurfaces,
  allow: EnvAllowlists = DEFAULT_ALLOWLISTS
): EnvCoverageResult => {
  const envDefault = new Set(s.envDefault);
  const read = new Set(s.allReads);

  const missingFromEnvDefault = sorted(
    s.runtimeReads.filter(
      (n) => !envDefault.has(n) && !allow.notOperatorSet.includes(n)
    )
  );
  const missingFromDocs = sorted(
    s.envDefault.filter((n) => !s.docs.some((d) => covers(d, n)))
  );
  const staleInAgents = sorted(s.agents.filter((n) => !envDefault.has(n)));
  const unread = sorted(
    s.envDefault.filter(
      (n) => !read.has(n) && !allow.readIndirectly.includes(n)
    )
  );

  return {
    ok:
      missingFromEnvDefault.length === 0 &&
      missingFromDocs.length === 0 &&
      staleInAgents.length === 0 &&
      unread.length === 0,
    missingFromEnvDefault,
    missingFromDocs,
    staleInAgents,
    unread
  };
};

const NAME = '[A-Z][A-Z0-9_]*';

const matchAll = (text: string, re: RegExp) =>
  [...text.matchAll(re)].map((m) => m[1]);

/**
 * The variables one source file reads: dot and quoted-bracket access on
 * `process.env`, and `requireEnv` with a literal name — the config helper that
 * reads `process.env[key]`. Placeholders here are lowercase, or this comment
 * would read as a read.
 */
export const extractEnvReads = (source: string): string[] =>
  sorted([
    ...matchAll(source, new RegExp(`process\\.env\\.(${NAME})`, 'g')),
    ...matchAll(
      source,
      new RegExp(`process\\.env\\[['"](${NAME})['"]\\]`, 'g')
    ),
    ...matchAll(source, new RegExp(`requireEnv\\(\\s*['"](${NAME})['"]`, 'g'))
  ]);

/** Prisma's `env("X")` reads in a schema. */
export const extractPrismaEnvReads = (schema: string): string[] =>
  sorted(matchAll(schema, new RegExp(`env\\(\\s*"(${NAME})"\\s*\\)`, 'g')));

/** The variables a dotenv file assigns; comments are not assignments. */
export const extractEnvAssignments = (dotenv: string): string[] =>
  sorted(matchAll(dotenv, new RegExp(`^(${NAME})=`, 'gm')));

/**
 * The names in the first column of the first table under `heading`. A cell
 * may list several names, and only the first column counts: a Purpose cell
 * may mention a retired variable by name.
 */
export const extractTableNames = (
  markdown: string,
  heading: string
): string[] => {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return [];
  const level = heading.match(/^#+/)?.[0] ?? '';
  const names: string[] = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (new RegExp(`^#{1,${level.length}} `).test(line)) break;
    if (!line.startsWith('|')) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    const firstCell = line.split('|')[1] ?? '';
    names.push(...matchAll(firstCell, new RegExp(`\`(${NAME}\\*?)\``, 'g')));
  }
  return sorted(names);
};
