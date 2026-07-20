/**
 * Built-in stylesheet fixtures — the api-canonical source for the themes the site
 * ships (ADR-0024). Each built-in theme is stored as an `AuthorStylesheet` row
 * owned by the reserved System user (bootstrap `seedSystemUser`) and delivered by
 * `GET /api/stylesheet/author-stylesheet/:id/css`; the site-registry `Stylesheet`
 * row's `cssUrl` points at that route, so the stored source is the single canonical
 * artifact — no silent duplicate of a static file (#285, #286).
 *
 * The CSS lives on disk under `prisma/seed-assets/stylesheets/` (shipped in the
 * image — Dockerfile copies `prisma/`) so it is authored/reviewed as real `.css`,
 * and a drift-guard spec reads the same files. Themes are token-only (stellar-ui
 * ADR-0005): a `:root { --st-* }` block, no selectors or assets, so they carry
 * nothing the store-time boundary (`lib/cssValidate.ts`) rejects — which the
 * seeder asserts at boot rather than assuming.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { cssValidate, formatCssViolations } from '../lib/cssValidate';

export const BUILTIN_STYLESHEET_FIXTURES = [
  {
    name: 'anorex',
    description: 'Classic wood-toned theme — brown/cream',
    file: 'anorex.css'
  },
  {
    name: 'dark-ambient',
    description: 'Deep atmospheric theme with muted blue',
    file: 'dark-ambient.css'
  },
  {
    name: 'kuro',
    description: 'Dark slate theme — muted blue accent',
    file: 'kuro.css'
  },
  {
    name: 'layer-cake',
    description: 'Classic light-grey theme (token reference)',
    file: 'layer-cake.css'
  },
  {
    name: 'shiro',
    description: 'Light neutral grey theme',
    file: 'shiro.css'
  },
  {
    name: 'mono',
    description: 'Clean light theme with a single blue accent',
    file: 'mono.css'
  },
  {
    name: 'minimal',
    description: 'Dark neutral theme with a bright cyan accent',
    file: 'minimal.css'
  },
  {
    name: 'hydro',
    description: 'Soft slate-blue light theme',
    file: 'hydro.css'
  },
  {
    name: 'bubblegum',
    description: 'Pastel-cyan theme with a hot-pink accent',
    file: 'bubblegum.css'
  },
  {
    name: 'white',
    description: 'Clean white theme with a sky-blue accent',
    file: 'white.css'
  }
] as const;

/**
 * The primitive `--st-*` Role Token set a conformant token-only theme MUST define
 * (stellar-ui ADR-0005 / docs/theming.md §3.1). Cross-repo coupling to the ui
 * contract — the drift-guard spec pins the seed-asset CSS against this list so a
 * built-in theme can never ship missing a primitive (the derived + geometry tokens
 * follow via `var()` and are not restated).
 */
export const REQUIRED_ST_PRIMITIVES = [
  // Surfaces
  '--st-backdrop',
  '--st-base',
  '--st-panel',
  '--st-raised',
  // Text
  '--st-text-strong',
  '--st-text',
  '--st-text-muted',
  '--st-text-faint',
  // Accent / Link
  '--st-accent',
  '--st-accent-hover',
  '--st-accent-ring',
  '--st-link',
  '--st-link-hover',
  // Borders
  '--st-border',
  '--st-border-subtle',
  '--st-border-strong',
  // Status
  '--st-danger',
  '--st-success',
  '--st-warning',
  '--st-info',
  // Quality
  '--st-lossless'
] as const;

const SEED_ASSET_DIR = resolve(
  __dirname,
  '../../prisma/seed-assets/stylesheets'
);

/** Read a built-in theme's canonical CSS off disk (shipped under prisma/). */
export const readFixtureCss = (file: string): string =>
  readFileSync(resolve(SEED_ASSET_DIR, file), 'utf8');

/**
 * Primitives absent from a theme's source, checked as *declarations* (`--st-x:`)
 * so `--st-text` is not spuriously matched inside `--st-text-strong`.
 */
export const missingStPrimitives = (css: string): string[] =>
  REQUIRED_ST_PRIMITIVES.filter(
    (token) => !new RegExp(`${token}\\s*:`).test(css)
  );

/** The `/css` delivery route for a stored AuthorStylesheet, by id. */
export const authorStylesheetCssUrl = (id: number): string =>
  `/api/stylesheet/author-stylesheet/${id}/css`;

/**
 * Seed the built-in stylesheet fixtures under the System user and repoint each
 * site-registry row at the `/css` route. Idempotent: matches an existing fixture
 * by (authorId, name) and always reconciles the registry `cssUrl` to the fixture's
 * live id. Requires `seedSystemUser` (the owner) to have run.
 *
 * **Asserts rather than launders (ADR-0031 §5).** A shipped theme that violates
 * the boundary fails at boot instead of being quietly cleaned into compliance.
 * The fixtures are the earliest available signal of what a member-authored sheet
 * will hit, and a canary that cannot fail is not a canary.
 *
 * **Propagates `source` on update (#351).** This previously read the CSS only on
 * create, so on an already-seeded database the disk bytes and the served bytes
 * diverged permanently — the boot assertion would read disk and pass while
 * `/css` served something else, and a security fix to a shipped theme reached no
 * existing instance. Clobbering is correct: the rows are System-owned, matched
 * on (authorId, name), and ADR-0024 makes the disk file the canonical artifact.
 */
export async function seedStylesheetFixtures(
  client: PrismaClient,
  systemUserId: number
): Promise<void> {
  for (const fixture of BUILTIN_STYLESHEET_FIXTURES) {
    const source = readFixtureCss(fixture.file);

    const violations = cssValidate(source);
    if (violations.length > 0) {
      throw new Error(
        `Built-in stylesheet '${fixture.name}' (${fixture.file}) violates the ADR-0031 boundary:\n` +
          formatCssViolations(violations)
            .map((m) => `  - ${m}`)
            .join('\n')
      );
    }

    const existing = await client.authorStylesheet.findFirst({
      where: { authorId: systemUserId, name: fixture.name },
      select: { id: true }
    });

    let fixtureId: number;
    if (existing) {
      fixtureId = existing.id;
      await client.authorStylesheet.update({
        where: { id: existing.id },
        data: { source }
      });
    } else {
      const created = await client.authorStylesheet.create({
        data: { authorId: systemUserId, name: fixture.name, source },
        select: { id: true }
      });
      fixtureId = created.id;
    }

    const cssUrl = authorStylesheetCssUrl(fixtureId);
    await client.stylesheet.upsert({
      where: { name: fixture.name },
      create: {
        name: fixture.name,
        description: fixture.description,
        cssUrl,
        isDefault: false
      },
      update: { description: fixture.description, cssUrl }
    });
  }
}
