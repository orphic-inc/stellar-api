/**
 * Models no production code hard-deletes (#752, #756, #758, #761).
 *
 * `prisma-guard-coverage-baseline.json` records module writes as internally
 * derived on exactly this fact: each write is checked, or read in the same
 * transaction, before it runs, and a row of these models cannot vanish in
 * between because nothing removes one. The reasons are text, and text cannot
 * notice when that stops being true. This spec can.
 *
 * If it fails, a hard delete has been added. Before changing a list below, give
 * every `internallyDerived` entry whose reason names this spec and that model a
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

/**
 * Each model, as its Prisma delegate and its table. A model reached only by a
 * cascade is listed with its parent: posts and polls cascade only from a
 * topic, and bounties only from a request.
 */
const NEVER_HARD_DELETED: Array<[delegate: string, table: string]> = [
  ['forumTopic', 'forum_topics'],
  ['forumPost', 'forum_posts'],
  ['forumPoll', 'forum_polls'],
  ['forumPostEdit', 'forum_post_edits'],
  // Users are disabled, never deleted (AGENTS.md, "Soft delete").
  ['user', 'users'],
  ['userSettings', 'user_settings'],
  ['request', 'requests'],
  ['requestBounty', 'request_bounties'],
  ['contribution', 'contributions'],
  // Withdrawn by `deletedAt` (DELETE /artists/:id); editions have no delete.
  ['artist', 'artists'],
  ['edition', 'editions'],
  // Tags only count down (occurrences); a tag row is never removed (#596).
  ['tag', 'tags'],
  // Staff PM tickets are resolved, never deleted (#596).
  ['staffInboxConversation', 'staff_inbox_conversations'],
  ['staffInboxMessage', 'staff_inbox_messages'],
  // A PM is hidden from a box (inInbox/inSentbox false), never deleted (#596).
  ['privateConversation', 'private_conversations'],
  ['privateConversationParticipant', 'private_conversation_participants'],
  ['privateMessage', 'private_messages'],
  ['downloadAccessGrant', 'download_access_grants'],
  ['consumer', 'consumers']
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

const hardDeleteOf = ([delegate, table]: [string, string]) =>
  new RegExp(
    `\\b${delegate}\\.delete(?:Many)?\\(|DELETE\\s+FROM\\s+"?${table}\\b`,
    'i'
  );

// A comment naming a delete is prose, not a call: artist.ts explains why it
// does not call `prisma.artist.delete()`.
const isCommentLine = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

const offendersFor = (model: [string, string]) => {
  const pattern = hardDeleteOf(model);
  return production.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) =>
        pattern.test(line) && !isCommentLine(line)
          ? [`${relative(ROOT, file)}:${i + 1}`]
          : []
      )
  );
};

describe('rows no production code hard-deletes', () => {
  it('finds production files to scan', () => {
    // Guards against a path mistake that would make the checks below vacuous.
    expect(production.some((f) => f.endsWith('modules/forum.ts'))).toBe(true);
  });

  it.each(NEVER_HARD_DELETED)('holds for %s', (delegate, table) => {
    expect(offendersFor([delegate, table])).toEqual([]);
  });

  // Checks the matcher itself, so a regex typo cannot pass every model above.
  it('skips comment lines, and only comment lines', () => {
    expect(isCommentLine('// so `prisma.artist.delete()` could only')).toBe(
      true
    );
    expect(isCommentLine(' * so `prisma.artist.delete()`')).toBe(true);
    expect(isCommentLine('  await prisma.artist.delete({ where });')).toBe(
      false
    );
  });

  it('would catch a delete of a listed model', () => {
    expect(
      hardDeleteOf(['forumTopic', 'forum_topics']).test(
        'await tx.forumTopic.delete({ where: { id } });'
      )
    ).toBe(true);
    expect(
      hardDeleteOf(['request', 'requests']).test(
        'await prisma.$executeRaw`DELETE FROM "requests" WHERE id = 1`'
      )
    ).toBe(true);
  });

  // The relations that keep a parent's delete from cascading into these rows.
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
  const modelBlock = (name: string): string =>
    schema.match(new RegExp(`\\nmodel ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';

  it('keeps Forum → ForumTopic as Restrict', () => {
    expect(modelBlock('ForumTopic')).toMatch(
      /forum\s+Forum\s+@relation\("ForumTopics",[^)]*onDelete: Restrict\)/
    );
  });

  // An edition or a contribution pins its release (#596): a release delete
  // fails while either exists, rather than taking them with it.
  it.each([
    ['Edition', 'release'],
    ['Contribution', 'release']
  ])('keeps Release → %s from cascading', (model, field) => {
    const line = modelBlock(model)
      .split('\n')
      .find((l) => new RegExp(`^\\s*${field}\\s+Release\\s+@relation`).test(l));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/onDelete:\s*Cascade/);
  });

  it('keeps Community → Request from cascading', () => {
    const line = modelBlock('Request')
      .split('\n')
      .find((l) => /^\s*community\s+Community\s+@relation/.test(l));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/onDelete:\s*Cascade/);
  });
});
