// AST extraction for the guard-coverage gate (#564). Takes source TEXT and
// returns MutationSites, so the hard part is testable without a filesystem; the
// CLI wrapper walks the tree and supplies the Prisma DMMF facts.
//
// Uses the TypeScript compiler API rather than a regex because three of the
// things the rule turns on are structural, not textual:
//
//   - `tx.foo.create(...)` inside `$transaction(async tx => ...)` is a mutation
//     site. Every count published for #564 read only `prisma.*` and so missed
//     133 of them.
//   - Whether a call sits inside a `try` whose `catch` translates a Prisma code
//     is a question about block nesting.
//   - The semantic owner (the route, or the exported function) is an ancestor,
//     not a nearby line.
//
// `typescript` is already a dependency, so this adds none (AGENTS.md #5).
import * as ts from 'typescript';
import type { Arm, MutationSite } from './prismaGuardCoverage';

/** Per-model constraint facts, read from the Prisma DMMF by the CLI. */
export interface ModelFacts {
  [camelModel: string]: { fk: boolean; unique: boolean };
}

/** Arm A: the write can violate a constraint the model owns. */
const ARM_A_OPS = new Set(['create', 'upsert']);
/** Arm B: addressed by id, so a missing row throws P2025 on ANY model. */
const ARM_B_OPS = new Set(['update', 'delete']);
/** Bulk variants: collected as sites, but never candidates — updateMany and
 *  deleteMany no-op on zero rows rather than throwing. */
const BULK_OPS = new Set(['createMany', 'updateMany', 'deleteMany']);

/** Every write op. Reads (findUnique, count, ...) are not sites at all. */
const MUTATION_OPS = new Set([...ARM_A_OPS, ...ARM_B_OPS, ...BULK_OPS]);

const PRISMA_CODE_RE = /P2002|P2003|P2025|PrismaClientKnownRequestError/;
const HTTP_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete']);

/**
 * `<anything>.bookmarkArtist.create(...)` → { model, op }, else null.
 *
 * Keyed on the MODEL name being one Prisma knows, not on the receiver being
 * literally `prisma` or `tx`. A client held under any other name would
 * otherwise be invisible, and one already is: `lib/audit.ts` writes through
 * `(client as PrismaClient).auditLog.create(...)`, where the receiver is a cast
 * expression. Requiring a known model keeps the false-positive risk to an
 * object that happens to carry a property named exactly like a Prisma model.
 */
const readCall = (
  node: ts.CallExpression,
  models: ModelFacts
): { model: string; op: string } | null => {
  const outer = node.expression;
  if (!ts.isPropertyAccessExpression(outer)) return null;
  const inner = outer.expression;
  if (!ts.isPropertyAccessExpression(inner)) return null;
  const op = outer.name.text;
  const model = inner.name.text;
  if (!MUTATION_OPS.has(op)) return null;
  return model in models ? { model, op } : null;
};

const armFor = (
  op: string,
  facts: ModelFacts[string] | undefined
): Arm | null => {
  if (ARM_B_OPS.has(op)) return 'B';
  if (!ARM_A_OPS.has(op)) return null;
  // An unconstrained create cannot violate anything, so it needs no guard.
  return facts && (facts.fk || facts.unique) ? 'A' : null;
};

/** True when the node sits in a `try` whose `catch` translates a Prisma code. */
const isGuarded = (node: ts.Node): boolean => {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    const parent: ts.Node | undefined = n.parent;
    if (
      parent !== undefined &&
      ts.isTryStatement(parent) &&
      n === parent.tryBlock &&
      parent.catchClause !== undefined &&
      PRISMA_CODE_RE.test(parent.catchClause.getText())
    ) {
      return true;
    }
  }
  return false;
};

/** `/artists/:artistId` → `/artists/{artistId}`, the dialect openapi.json uses. */
const toContractPath = (p: string): string =>
  p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/** The enclosing `router.post('/x', ...)` call, as `POST /x`, or null. */
const routeOwner = (node: ts.Node): string | null => {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (!ts.isCallExpression(n)) continue;
    const callee = n.expression;
    if (!ts.isPropertyAccessExpression(callee)) continue;
    if (!ts.isIdentifier(callee.expression)) continue;
    const verb = callee.name.text;
    if (!HTTP_VERBS.has(verb)) continue;
    const first = n.arguments[0];
    if (!first || !ts.isStringLiteralLike(first)) continue;
    return `${verb.toUpperCase()} ${toContractPath(first.text)}`;
  }
  return null;
};

/** The nearest named function or `const foo = ...` binding, or null. */
const functionOwner = (node: ts.Node): string | null => {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name))
      return n.name.text;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name))
      return n.name.text;
  }
  return null;
};

export interface ScanOptions {
  /** Repo-relative path, e.g. `src/routes/api/bookmarks.ts`. */
  fileName: string;
  sourceText: string;
  models: ModelFacts;
  area: 'routes' | 'modules' | 'lib';
  /** Mount prefix for a route file, e.g. `/bookmarks`. Empty for modules. */
  mountPrefix?: string;
}

const ownerFor = (node: ts.Node, o: ScanOptions): string => {
  if (o.area === 'routes') {
    const route = routeOwner(node);
    // A route file with an unresolvable owner still gets a stable key rather
    // than being dropped — an unkeyable site is one the gate cannot see.
    if (route) {
      const [verb, path] = route.split(' ');
      const mount = toContractPath(o.mountPrefix ?? '');
      return `${verb} ${mount}${path === '/' ? '' : path}`;
    }
  }
  const fn = functionOwner(node);
  return fn ? `${o.fileName}::${fn}` : o.fileName;
};

/**
 * Every Prisma mutation call site in one source file.
 *
 * Keys collide when one owner repeats a model+op (a handler that updates the
 * same model twice); a `#n` ordinal disambiguates, assigned in source order.
 */
export const collectMutationSites = (o: ScanOptions): MutationSite[] => {
  const src = ts.createSourceFile(
    o.fileName,
    o.sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true
  );
  const sites: MutationSite[] = [];
  const seen = new Map<string, number>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const call = readCall(node, o.models);
      if (call) {
        const base = `${ownerFor(node, o)}::${call.model}.${call.op}`;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        sites.push({
          key: n === 1 ? base : `${base}#${n}`,
          area: o.area,
          model: call.model,
          op: call.op,
          arm: armFor(call.op, o.models[call.model]),
          guarded: isGuarded(node)
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return sites;
};
