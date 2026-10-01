import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import {
  checkEnvCoverage,
  extractEnvAssignments,
  extractEnvReads,
  extractPrismaEnvReads,
  extractTableNames
} from '../lib/envCoverage';

// Gathers the environment surfaces and feeds them to the pure checker (#682).
//
//   npm run env:coverage        check (exit 1 on failure)

const root = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const tsFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });

// Not runtime: CI and e2e tooling, and the test suites.
const NON_RUNTIME = /^src\/(scripts|test|integration)\/|\.spec\.ts$/;

const main = () => {
  const runtimeReads: string[] = [];
  const allReads: string[] = extractPrismaEnvReads(
    read('prisma/schema.prisma')
  );
  for (const file of tsFiles(join(root, 'src'))) {
    const reads = extractEnvReads(readFileSync(file, 'utf8'));
    allReads.push(...reads);
    if (!NON_RUNTIME.test(relative(root, file))) runtimeReads.push(...reads);
  }

  const r = checkEnvCoverage({
    runtimeReads,
    allReads,
    envDefault: extractEnvAssignments(read('.env.default')),
    docs: extractTableNames(read('docs/README.md'), '## Environment reference'),
    agents: extractTableNames(read('AGENTS.md'), '## Environment')
  });

  const report = (names: string[], message: string) => {
    for (const n of names) console.error(`${message}: ${n}`);
  };
  report(r.missingFromEnvDefault, 'Read by runtime code, not in .env.default');
  report(r.missingFromDocs, 'In .env.default, not in docs/README.md');
  report(r.staleInAgents, "In AGENTS.md's table, not in .env.default");
  report(r.unread, 'In .env.default, read by nothing');

  if (!r.ok) {
    console.error(
      '\n.env.default lists every variable an operator sets; docs/README.md ' +
        'explains each one; AGENTS.md names a subset. A retired variable ' +
        'leaves all three (#682).'
    );
    process.exit(1);
  }
  console.log('Environment coverage OK.');
};

main();
