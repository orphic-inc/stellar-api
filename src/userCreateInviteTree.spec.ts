import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * Every account gets an InviteTree row (#633, ADR-0042).
 *
 * The rule lives in TypeScript rather than a database trigger, so something has
 * to notice a new account-creation path that forgets it. This spec parses the
 * source and fails on any `<client>.user.create(...)` whose `data` does not
 * carry an `inviteTree` key, and on any `user.upsert` whose `create` does not.
 * `user.createMany` cannot nest a relation at all, so it is refused outright.
 *
 * WHAT IT CANNOT SEE: a `user` delegate reached through an alias
 * (`const users = prisma.user; users.create(...)`) or a computed property.
 * Nothing in the tree does that today.
 */

const ROOTS = ['src', 'prisma'];
const SKIPPED_DIRS = new Set(['integration', 'test', 'node_modules']);

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

const propertyNamed = (
  obj: ts.ObjectLiteralExpression,
  name: string
): ts.ObjectLiteralElementLike | undefined =>
  obj.properties.find(
    (p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      p.name.getText() === name
  );

/** Is `expr` the `user` delegate, as in `prisma.user` or `tx['user']`? */
const isUserDelegate = (expr: ts.Expression): boolean =>
  (ts.isPropertyAccessExpression(expr) && expr.name.text === 'user') ||
  (ts.isElementAccessExpression(expr) &&
    ts.isStringLiteral(expr.argumentExpression) &&
    expr.argumentExpression.text === 'user');

/** Why this object fails to carry `inviteTree` under `key`, or null if it does. */
const missingInviteTree = (
  arg: ts.Expression | undefined,
  key: 'data' | 'create'
): string | null => {
  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    return 'arguments are not an object literal, so inviteTree cannot be verified';
  }
  const prop = propertyNamed(arg, key);
  if (!prop || !ts.isPropertyAssignment(prop)) {
    return `\`${key}\` is not written inline, so inviteTree cannot be verified`;
  }
  if (!ts.isObjectLiteralExpression(prop.initializer)) {
    return `\`${key}\` is not an object literal, so inviteTree cannot be verified`;
  }
  return propertyNamed(prop.initializer, 'inviteTree')
    ? null
    : `\`${key}\` has no inviteTree`;
};

const findViolations = (fileName: string, source: string): string[] => {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const out: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      isUserDelegate(node.expression.expression)
    ) {
      const method = node.expression.name.text;
      const [arg] = node.arguments;
      const reason =
        method === 'create'
          ? missingInviteTree(arg, 'data')
          : method === 'upsert'
            ? missingInviteTree(arg, 'create')
            : method === 'createMany' || method === 'createManyAndReturn'
              ? `${method} cannot nest inviteTree; create accounts one at a time`
              : null;
      if (reason) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        out.push(`${fileName}:${line + 1} user.${method}: ${reason}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};

describe('every user.create writes an InviteTree row (#633)', () => {
  it('holds across src and prisma', () => {
    const violations = ROOTS.flatMap(collectFiles).flatMap((f) =>
      findViolations(f, readFileSync(f, 'utf8'))
    );
    expect(violations).toEqual([]);
  });

  // Tried to fool it before trusting it.
  describe('the checker', () => {
    const check = (body: string) => findViolations('fixture.ts', body);

    it('passes an inline data object carrying inviteTree', () => {
      expect(
        check('tx.user.create({ data: { a: 1, inviteTree: { create: {} } } });')
      ).toEqual([]);
    });

    it('accepts a shorthand inviteTree property', () => {
      expect(check('prisma.user.create({ data: { inviteTree } });')).toEqual(
        []
      );
    });

    it('flags data without inviteTree', () => {
      expect(check('prisma.user.create({ data: { a: 1 } });')).toHaveLength(1);
    });

    it('flags data built from a spread alone, even if the spread might carry it', () => {
      expect(check('prisma.user.create({ data: { ...rest } });')).toHaveLength(
        1
      );
    });

    it('flags data passed as a variable', () => {
      expect(check('prisma.user.create({ data });')).toHaveLength(1);
      expect(check('prisma.user.create(args);')).toHaveLength(1);
    });

    it('flags an element-access delegate', () => {
      expect(check("prisma['user'].create({ data: {} });")).toHaveLength(1);
    });

    it('flags an upsert whose create branch lacks inviteTree', () => {
      expect(
        check(
          'prisma.user.upsert({ where: {}, update: {}, create: { a: 1 } });'
        )
      ).toHaveLength(1);
    });

    it('refuses createMany', () => {
      expect(check('prisma.user.createMany({ data: [] });')).toHaveLength(1);
    });

    it('ignores other models and other user methods', () => {
      expect(
        check(
          'prisma.inviteTree.create({ data: {} }); prisma.user.update({ where: {}, data: {} });'
        )
      ).toEqual([]);
    });
  });
});
