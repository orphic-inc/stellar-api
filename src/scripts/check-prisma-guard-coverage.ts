// CLI wrapper for the guard-coverage gate (#564). All the I/O lives here; the
// comparison is pure in lib/prismaGuardCoverage.ts and the AST extraction is
// text-in/sites-out in lib/prismaMutationSites.ts.
//
//   npm run prisma:guard-coverage                  check (exit 1 on failure)
//   npm run prisma:guard-coverage -- --write       regenerate the baseline
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import * as ts from 'typescript';
import { Prisma } from '@prisma/client';
import {
  checkPrismaGuardCoverage,
  type Baseline,
  type MutationSite
} from '../lib/prismaGuardCoverage';
import {
  collectMutationSites,
  type ModelFacts
} from '../lib/prismaMutationSites';

const ROOT = resolve(__dirname, '../..');
const BASELINE = join(ROOT, 'prisma-guard-coverage-baseline.json');
const GATED = ['routes'] as const;

/** Per-model constraint facts — the authority for arm A's precondition. */
const modelFacts = (): ModelFacts => {
  const out: ModelFacts = {};
  for (const m of Prisma.dmmf.datamodel.models) {
    const camel = m.name.charAt(0).toLowerCase() + m.name.slice(1);
    out[camel] = {
      fk: m.fields.some((f) => (f.relationFromFields ?? []).length > 0),
      unique:
        (m.uniqueFields ?? []).length > 0 || m.fields.some((f) => f.isUnique)
    };
  }
  return out;
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });

/** `foo` → the file `import foo from './routes/api/foo'` resolves to. */
const importSources = (
  src: ts.SourceFile,
  file: string
): Map<string, string> => {
  const out = new Map<string, string>();
  for (const st of src.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.name) continue;
    if (!ts.isStringLiteralLike(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (!spec.startsWith('.')) continue;
    out.set(st.importClause.name.text, `${resolve(dirname(file), spec)}.ts`);
  }
  return out;
};

/** Every `x.use('<prefix>', <ident>)` in a file, as [prefix, ident]. */
const mountCalls = (src: ts.SourceFile): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'use' &&
      n.arguments.length >= 2 &&
      ts.isStringLiteralLike(n.arguments[0]) &&
      ts.isIdentifier(n.arguments[1])
    ) {
      out.push([n.arguments[0].text, n.arguments[1].text]);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
};

/**
 * file → mount prefix, walked from app.ts through nested `router.use`.
 * Sub-routers are real here: communities mounts releases, forums mount topics
 * which mount posts, so a single top-level pass would key three files wrongly.
 */
const mountPrefixes = (): Map<string, string> => {
  const out = new Map<string, string>();
  const parse = (f: string) =>
    ts.createSourceFile(
      f,
      readFileSync(f, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
  const visit = (file: string, prefix: string, depth: number): void => {
    if (depth > 5 || out.has(file)) return;
    out.set(file, prefix);
    let src: ts.SourceFile;
    try {
      src = parse(file);
    } catch {
      return;
    }
    const imports = importSources(src, file);
    for (const [sub, ident] of mountCalls(src)) {
      const target = imports.get(ident);
      if (target) visit(target, `${prefix}${sub}`, depth + 1);
    }
  };
  const app = join(ROOT, 'src/app.ts');
  const src = parse(app);
  const imports = importSources(src, app);
  for (const [prefix, ident] of mountCalls(src)) {
    const target = imports.get(ident);
    // Strip the `/api` base, as openapi.json does — one dialect, both gates.
    if (target) visit(target, prefix.replace(/^\/api/, ''), 1);
  }
  return out;
};

const collectAll = (): MutationSite[] => {
  const models = modelFacts();
  const prefixes = mountPrefixes();
  const areas = [
    ['routes', join(ROOT, 'src/routes')],
    ['modules', join(ROOT, 'src/modules')],
    ['lib', join(ROOT, 'src/lib')]
  ] as const;
  return areas.flatMap(([area, dir]) =>
    walk(dir).flatMap((file) =>
      collectMutationSites({
        fileName: relative(ROOT, file),
        sourceText: readFileSync(file, 'utf8'),
        models,
        area,
        mountPrefix: prefixes.get(file) ?? ''
      })
    )
  );
};

const emptyBaseline = (): Baseline => ({
  internallyDerived: {},
  unreviewed: []
});

const loadBaseline = (): Baseline => {
  try {
    const raw = JSON.parse(readFileSync(BASELINE, 'utf8'));
    return {
      internallyDerived: raw.internallyDerived ?? {},
      unreviewed: raw.unreviewed ?? []
    };
  } catch {
    return emptyBaseline();
  }
};

const writeBaseline = (sites: MutationSite[]): void => {
  const unreviewed = sites
    .filter(
      (s) => s.arm !== null && !s.guarded && GATED.includes(s.area as 'routes')
    )
    .map((s) => s.key)
    .sort();
  const existing = loadBaseline();
  // Filter BEFORE reporting: a site recorded as internally derived is not
  // unreviewed, and logging the pre-filter total contradicts what the very next
  // check prints. This series is about numbers being re-derivable, so its own
  // tooling should not publish two.
  const stillUnreviewed = unreviewed.filter(
    (k) => !(k in existing.internallyDerived)
  );
  const body = {
    $comment:
      'Guard-coverage ratchet (#564). `unreviewed` is a backlog to burn down, ' +
      'not a mute button: a new unguarded site fails, and an entry that becomes ' +
      'guarded or disappears fails as stale. `internallyDerived` records sites ' +
      'whose constrained ids cannot dangle (session- or internally-sourced), ' +
      'each with the reason — a prior read is NOT a reason, it leaves a TOCTOU ' +
      'window. Regenerate with: npm run prisma:guard-coverage -- --write',
    generated: new Date().toISOString().slice(0, 10),
    internallyDerived: existing.internallyDerived,
    unreviewed: stillUnreviewed
  };
  writeFileSync(BASELINE, `${JSON.stringify(body, null, 2)}\n`);
  console.log(
    `Baseline written: ${stillUnreviewed.length} unreviewed, ` +
      `${Object.keys(existing.internallyDerived).length} internally derived`
  );
};

const main = (): void => {
  const sites = collectAll();
  if (process.argv.includes('--write')) return writeBaseline(sites);

  const r = checkPrismaGuardCoverage({
    sites,
    baseline: loadBaseline(),
    gated: GATED
  });
  const t = r.totals;
  console.log(
    `${t.sites} prisma mutation sites, ${t.candidates} need a guard ` +
      `(${t.guarded} guarded, ${t.internallyDerived} internally derived, ` +
      `${t.unreviewed} unreviewed, ${t.countedOnly} counted in src/modules + src/lib but not gated).`
  );
  for (const k of r.newlyUnguarded) {
    console.error(`UNGUARDED, not baselined: ${k}`);
  }
  for (const k of r.staleBaseline) {
    console.error(`STALE baseline entry (now guarded, or gone): ${k}`);
  }
  if (!r.ok) {
    console.error(
      '\nA Prisma write that can violate a constraint must translate the code — ' +
        'see friends.ts:195 for the idiom. Run with --write only to record a ' +
        'site as internally derived, never to silence a real one.'
    );
    process.exit(1);
  }
  console.log('Guard coverage OK.');
};

main();
