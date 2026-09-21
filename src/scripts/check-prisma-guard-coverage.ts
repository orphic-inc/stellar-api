```typescript
// CLI wrapper for env coverage check. Reads code (process.env reads),
// .env.default, and docs/README.md to enforce the invariant:
// code vars ⊆ .env.default vars ⊆ docs/README.md documented vars.
//
//   npm run env:coverage
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '../..');
const ENV_DEFAULT = join(ROOT, '.env.default');
const DOCS_README = join(ROOT, 'docs/README.md');
const SRC_DIR = join(ROOT, 'src');

const ALLOWLIST = new Set([
  'NODE_ENV',
  'DATABASE_URL',
  'CI',
  'PORT',
  'HOST',
  'VERCEL',
  'VERCEL_URL',
  'RAILWAY_STATIC_URL',
  'RENDER'
]);

const walk = (dir: string): string[] => {
  try {
    return readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) return walk(p);
      return p.endsWith('.ts') ? [p] : [];
    });
  } catch {
    return [];
  }
};

const extractCodeEnvVars = (): Set<string> => {
  const vars = new Set<string>();
  const files = walk(SRC_DIR);
  // Match both process.env.FOO and process.env['FOO'] or process.env["FOO"]
  const dotRegex = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  const bracketRegex = /process\.env\['([A-Z][A-Z0-9_]*)'\]|process\.env\["([A-Z][A-Z0-9_]*)"\]/g;

  for (const file of files) {
    let content = '';
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    let match: RegExpExecArray | null;
    while ((match = dotRegex.exec(content)) !== null) {
      if (match[1]) vars.add(match[1]);
    }
    while ((match = bracketRegex.exec(content)) !== null) {
      const v = match[1] || match[2];
      if (v) vars.add(v);
    }
  }

  for (const v of ALLOWLIST) {
    vars.delete(v);
  }

  return vars;
};

const extractEnvDefaultVars = (): Set<string> => {
  const vars = new Set<string>();
  let content = '';
  try {
    content = readFileSync(ENV_DEFAULT, 'utf8');
  } catch {
    return vars;
  }

  const regex = /^([A-Z][A-Z0-9_]*)=/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) vars.add(match[1]);
  }
  return vars;
};

const extractDocsVars = (): Set<string> => {
  const vars = new Set<string>();
  let content = '';
  try {
    content = readFileSync(DOCS_README, 'utf8');
  } catch {
    return vars;
  }

  // Matches identifiers in code spans or table columns, e.g., STELLAR_FOO or STELLAR_SMTP_*
  const regex = /\b(STELLAR_[A-Z0-9_]+)\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) vars.add(match[1]);
  }
  return vars;
};

const main = () => {
  const codeVars = extractCodeEnvVars();
  const envDefaultVars = extractEnvDefaultVars();
  const docsVars = extractDocsVars();

  let failed = false;

  // Invariant 1: Code ⊆ .env.default
  const missingInEnvDefault = [...codeVars].filter((v) => !envDefaultVars.has(v));
  if (missingInEnvDefault.length > 0) {
    console.error('❌ Variables found in code but missing from .env.default:');
    for (const v of missingInEnvDefault.sort()) {
      console.error(`   - ${v}`);
    }
    failed = true;
  }

  // Invariant 2: .env.default ⊆ Docs (supporting wildcards like STELLAR_SMTP_*)
  const missingInDocs = [...envDefaultVars].filter((v) => {
    if (docsVars.has(v)) return false;
    // Check wildcard matches, e.g., STELLAR_SMTP_HOST matches STELLAR_SMTP_*
    for (const dVar of docsVars) {
      if (dVar.endsWith('*')) {
        const prefix = dVar.slice(0, -1);
        if (v.startsWith(prefix)) return false;
      }
    }
    return true;
  });

  if (missingInDocs.length > 0) {
    console.error('❌ Variables found in .env.default but missing from docs/README.md:');
    for (const v of missingInDocs.sort()) {
      console.error(`   - ${v}`);
    }
    failed = true;
  }

  if (failed) {
    console.error('\nEnvironment coverage check failed. Please update .env.default and docs/README.md.');
    process.exit(1);
  } else {
    console.log('✅ Environment coverage check passed successfully.');
    process.exit(0);
  }
};

main();
```
// CLI wrapper for env coverage check. Reads code (process.env reads),
// .env.default, and docs/README.md to enforce the invariant:
// code vars ⊆ .env.default vars ⊆ docs/README.md documented vars.
//
//   npm run env:coverage
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '../..');
const ENV_DEFAULT = join(ROOT, '.env.default');
const DOCS_README = join(ROOT, 'docs/README.md');
const SRC_DIR = join(ROOT, 'src');

const ALLOWLIST = new Set([
  'NODE_ENV',
  'DATABASE_URL',
  'CI',
  'PORT',
  'HOST',
  'VERCEL',
  'VERCEL_URL',
  'RAILWAY_STATIC_URL',
  'RENDER'
]);

const walk = (dir: string): string[] => {
  try {
    return readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) return walk(p);
      return p.endsWith('.ts') ? [p] : [];
    });
  } catch {
    return [];
  }
};

const extractCodeEnvVars = (): Set<string> => {
  const vars = new Set<string>();
  const files = walk(SRC_DIR);
  // Match both process.env.FOO and process.env['FOO'] or process.env["FOO"]
  const dotRegex = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  const bracketRegex = /process\.env\['([A-Z][A-Z0-9_]*)'\]|process\.env\["([A-Z][A-Z0-9_]*)"\]/g;

  for (const file of files) {
    let content = '';
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    let match: RegExpExecArray | null;
    while ((match = dotRegex.exec(content)) !== null) {
      if (match[1]) vars.add(match[1]);
    }
    while ((match = bracketRegex.exec(content)) !== null) {
      const v = match[1] || match[2];
      if (v) vars.add(v);
    }
  }

  for (const v of ALLOWLIST) {
    vars.delete(v);
  }

  return vars;
};

const extractEnvDefaultVars = (): Set<string> => {
  const vars = new Set<string>();
  let content = '';
  try {
    content = readFileSync(ENV_DEFAULT, 'utf8');
  } catch {
    return vars;
  }

  const regex = /^([A-Z][A-Z0-9_]*)=/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) vars.add(match[1]);
  }
  return vars;
};

const extractDocsVars = (): Set<string> => {
  const vars = new Set<string>();
  let content = '';
  try {
    content = readFileSync(DOCS_README, 'utf8');
  } catch {
    return vars;
  }

  // Matches identifiers in code spans or table columns, e.g., STELLAR_FOO or STELLAR_SMTP_*
  const regex = /\b(STELLAR_[A-Z0-9_]+)\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) vars.add(match[1]);
  }
  return vars;
};

const main = () => {
  const codeVars = extractCodeEnvVars();
  const envDefaultVars = extractEnvDefaultVars();
  const docsVars = extractDocsVars();

  let failed = false;

  // Invariant 1: Code ⊆ .env.default
  const missingInEnvDefault = [...codeVars].filter((v) => !envDefaultVars.has(v));
  if (missingInEnvDefault.length > 0) {
    console.error('❌ Variables found in code but missing from .env.default:');
    for (const v of missingInEnvDefault.sort()) {
      console.error(`   - ${v}`);
    }
    failed = true;
  }

  // Invariant 2: .env.default ⊆ Docs (supporting wildcards like STELLAR_SMTP_*)
  const missingInDocs = [...envDefaultVars].filter((v) => {
    if (docsVars.has(v)) return false;
    // Check wildcard matches, e.g., STELLAR_SMTP_HOST matches STELLAR_SMTP_*
    for (const dVar of docsVars) {
      if (dVar.endsWith('*')) {
        const prefix = dVar.slice(0, -1);
        if (v.startsWith(prefix)) return false;
      }
    }
    return true;
  });

  if (missingInDocs.length > 0) {
    console.error('❌ Variables found in .env.default but missing from docs/README.md:');
    for (const v of missingInDocs.sort()) {
      console.error(`   - ${v}`);
    }
    failed = true;
  }

  if (failed) {
    console.error('\nEnvironment coverage check failed. Please update .env.default and docs/README.md.');
    process.exit(1);
  } else {
    console.log('✅ Environment coverage check passed successfully.');
    process.exit(0);
  }
};

main();
