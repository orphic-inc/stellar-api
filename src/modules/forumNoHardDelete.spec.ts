/**
 * No production code hard-deletes a forum topic, post or poll (#752).
 *
 * `prisma-guard-coverage-baseline.json` records eleven `forum.ts` writes as
 * internally derived on exactly that fact: each is checked before it runs, and
 * a row of these models cannot vanish in between, because nothing removes one.
 * The reasons are text, and text cannot notice when that stops being true.
 * This spec can.
 *
 * If it fails, a hard delete has been added. Before changing this list, give
 * every `forum.ts` entry in `internallyDerived` whose reason names this spec a
 * real guard (`translatePrismaError`, ADR-0048), then delete its baseline
 * entry.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

// Dev-only and test code never serves a production request (ADR-0048).
const EXCLUDED = [
  'src/modules/devTools/',
  'src/test/',
  'src/integration/',
  'src/scripts/'
];

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });

const production = sourceFiles(SRC).filter((file) => {
  const rel = relative(ROOT, file);
  return !EXCLUDED.some((prefix) => rel.startsWith(prefix));
});

// A Prisma delegate call, or raw SQL against the table. Cascades are covered
// by the same list: a post or poll cascades only from a topic.
const HARD_DELETE =
  /\b(?:forumTopic|forumPost|forumPoll|forumPostEdit)\.delete(?:Many)?\(|DELETE\s+FROM\s+"?forum_(?:topics|posts|polls|post_edits)\b/i;

describe('forum rows are never hard-deleted', () => {
  it('finds production files to scan', () => {
    // Guards against a path mistake that would make the check below vacuous.
    expect(production.some((f) => f.endsWith('modules/forum.ts'))).toBe(true);
  });

  it('holds: no production code hard-deletes a topic, post or poll', () => {
    const offenders = production.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          HARD_DELETE.test(line) ? [`${relative(ROOT, file)}:${i + 1}`] : []
        )
    );
    expect(offenders).toEqual([]);
  });

  // Forum → topic is Restrict, so deleting a forum cannot cascade into topics.
  it('keeps forum → topic as Restrict in the schema', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
    expect(schema).toMatch(
      /forum\s+Forum\s+@relation\("ForumTopics",[^)]*onDelete: Restrict\)/
    );
  });
});
