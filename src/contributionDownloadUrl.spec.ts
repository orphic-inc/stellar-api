import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * No read reveals a Contribution's `downloadUrl` without a Download Grant
 * (#908). The URL is the download without the grant's debit, so only the grant
 * and the uploader's own uploads list may carry it.
 *
 * The leak #908 closed was one `downloadUrl: true` in a release read's select.
 * This spec parses the source and counts, per file, the three ways a query
 * comes back holding the URL:
 *
 * - `select`  — a `downloadUrl: true` property
 * - `bare`    — a `<client>.contribution.<method>(...)` with no inline `select`,
 *               which returns every scalar
 * - `include` — `contribution: true` or `contributions: true` inside an
 *               `include`, which does the same through a relation
 *
 * Each count must match ALLOWED exactly, and each entry says why its rows never
 * reach a reader without a grant. A new site fails, and so does a second site
 * in an allowed file. Remove an entry when its site goes.
 *
 * WHAT IT CANNOT SEE: a select built elsewhere and passed by name, a delegate
 * reached through an alias, or a computed property name. Nothing in the tree
 * does that for a contribution today.
 */

type Kind = 'select' | 'bare' | 'include';

const ALLOWED: Record<string, Partial<Record<Kind, number>> & { why: string }> =
  {
    'src/modules/downloads.ts': {
      select: 1,
      why: 'the Download Grant itself: it debits, then returns the URL'
    },
    'src/routes/api/downloads.ts': {
      select: 1,
      why: '`/access/latest`: re-serves a grant made in the last two minutes'
    },
    'src/routes/api/communities/contributions.ts': {
      select: 1,
      why: '`GET /contributions`: the caller’s own uploads only'
    },
    'src/modules/linkHealth.ts': {
      select: 1,
      why: 'the link checker probes the URL server-side and returns only a status'
    },
    'src/modules/releaseWorkbench/contributions.ts': {
      bare: 1,
      why: '`assertMayAttach`: an existence check, whose row is never returned'
    },
    'src/modules/requestLifecycle.ts': {
      bare: 1,
      why: '`fillRequest`: an ownership check, whose row is never returned'
    },
    'src/modules/devTools/generators/contributions.ts': {
      bare: 1,
      why: 'dev-only content factory: writes generated rows'
    },
    'src/scripts/seed-korin-e2e.ts': {
      bare: 1,
      why: 'e2e seed script: writes a fixture row, run from the command line'
    }
  };

const ROOTS = ['src', 'prisma'];
const SKIPPED_DIRS = new Set(['integration', 'test', 'node_modules']);
const CONTRIBUTION_METHODS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'findMany',
  'create',
  'createManyAndReturn',
  'update',
  'updateManyAndReturn',
  'upsert',
  'delete'
]);

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

const nameOf = (p: ts.ObjectLiteralElementLike): string | undefined =>
  p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
    ? p.name.text
    : undefined;

const isTrue = (p: ts.PropertyAssignment): boolean =>
  p.initializer.kind === ts.SyntaxKind.TrueKeyword;

/** Is `expr` the `contribution` delegate, as in `prisma.contribution`? */
const isContributionDelegate = (expr: ts.Expression): boolean =>
  (ts.isPropertyAccessExpression(expr) && expr.name.text === 'contribution') ||
  (ts.isElementAccessExpression(expr) &&
    ts.isStringLiteral(expr.argumentExpression) &&
    expr.argumentExpression.text === 'contribution');

const hasInlineSelect = (arg: ts.Expression | undefined): boolean =>
  !!arg &&
  ts.isObjectLiteralExpression(arg) &&
  arg.properties.some((p) => nameOf(p) === 'select');

/** Is this property the value of an `include: { ... }`? */
const isInsideInclude = (p: ts.PropertyAssignment): boolean => {
  const obj = p.parent;
  return (
    ts.isPropertyAssignment(obj.parent) && nameOf(obj.parent) === 'include'
  );
};

const kindOf = (node: ts.Node): Kind | null => {
  if (ts.isPropertyAssignment(node) && isTrue(node)) {
    const name = nameOf(node);
    if (name === 'downloadUrl') return 'select';
    if (
      (name === 'contribution' || name === 'contributions') &&
      isInsideInclude(node)
    ) {
      return 'include';
    }
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    isContributionDelegate(node.expression.expression) &&
    CONTRIBUTION_METHODS.has(node.expression.name.text) &&
    !hasInlineSelect(node.arguments[0])
  ) {
    return 'bare';
  }
  return null;
};

const countSites = (
  fileName: string,
  source: string
): Partial<Record<Kind, number>> => {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const counts: Partial<Record<Kind, number>> = {};
  const visit = (node: ts.Node) => {
    const kind = kindOf(node);
    if (kind) counts[kind] = (counts[kind] ?? 0) + 1;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return counts;
};

describe('no read reveals a downloadUrl without a grant (#908)', () => {
  it('finds exactly the allowed sites across src and prisma', () => {
    const found: Record<string, Partial<Record<Kind, number>>> = {};
    for (const file of ROOTS.flatMap(collectFiles)) {
      const counts = countSites(file, readFileSync(file, 'utf8'));
      if (Object.keys(counts).length) found[file] = counts;
    }
    const expected = Object.fromEntries(
      Object.entries(ALLOWED).map(([file, { why: _why, ...counts }]) => [
        file,
        counts
      ])
    );
    expect(found).toEqual(expected);
  });

  // Tried to fool it before trusting it.
  describe('the checker', () => {
    const check = (body: string) => countSites('fixture.ts', body);

    it('counts a downloadUrl select, nested or not', () => {
      expect(
        check(
          'prisma.release.findMany({ select: { contributions: { select: { downloadUrl: true } } } });'
        )
      ).toEqual({ select: 1 });
    });

    it('ignores a downloadUrl written as data', () => {
      expect(
        check(
          'prisma.contribution.update({ where, data: { downloadUrl: url }, select: { id: true } });'
        )
      ).toEqual({});
    });

    it('counts a contribution read with no select', () => {
      expect(check('tx.contribution.findMany({ where });')).toEqual({
        bare: 1
      });
      expect(check('prisma.contribution.findUnique(args);')).toEqual({
        bare: 1
      });
      expect(check("prisma['contribution'].findFirst({});")).toEqual({
        bare: 1
      });
    });

    it('counts an include on a contribution read as bare too', () => {
      expect(
        check('prisma.contribution.findFirst({ include: { release: true } });')
      ).toEqual({ bare: 1 });
    });

    it('passes a contribution read with an inline select', () => {
      expect(
        check('prisma.contribution.findMany({ select: { id: true } });')
      ).toEqual({});
    });

    it('counts a whole-row relation include', () => {
      expect(
        check('prisma.release.findMany({ include: { contributions: true } });')
      ).toEqual({ include: 1 });
      expect(
        check("prisma.grant.findMany({ include: { 'contribution': true } });")
      ).toEqual({ include: 1 });
    });

    it('ignores a relation count', () => {
      expect(
        check(
          'prisma.release.findMany({ select: { _count: { select: { contributions: true } } } });'
        )
      ).toEqual({});
    });

    it('ignores count, exists checks and other models', () => {
      expect(
        check(
          'prisma.contribution.count({ where }); prisma.contribution.deleteMany({ where }); prisma.release.findMany({ where });'
        )
      ).toEqual({});
    });
  });
});
