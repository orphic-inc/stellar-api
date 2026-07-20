/**
 * Built-in binary asset fixtures — the bytes an asset-bearing built-in theme
 * references (ADR-0026, #341). Shipped on disk under
 * `prisma/seed-assets/assets/<theme>/` (the Dockerfile copies `prisma/`) and
 * loaded into the content-addressed store at boot, so a theme's imagery resolves
 * from the api that serves the theme rather than from another repo's static tree.
 *
 * **The reference is pre-rewritten, not patched at seed time.** A fixture `.css`
 * checks in `url('/api/asset/<sha256>')` directly. The hash is a pure function of
 * the bytes, so the reference is stable across every environment, and the stored
 * source stays byte-identical to the file on disk — which is what lets ADR-0031's
 * verbatim storage and the drift guard both hold. Seed-time string surgery would
 * have broken that, and is why this indirection exists at all.
 *
 * Ordering matters: `seedAssetFixtures` runs *before* `seedStylesheetFixtures`
 * (see `seedAll`), so a theme is never briefly served with dangling targets.
 */
import { PrismaClient } from '@prisma/client';
import type { AssetKind } from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { putAsset } from './assetStore';

export interface BuiltinAssetFixture {
  /** The built-in theme these bytes belong to — also the on-disk directory. */
  theme: string;
  file: string;
  kind: AssetKind;
}

/**
 * Every binary a built-in theme references. Deliberately a manifest rather than a
 * directory scan: the drift guard asserts this list and the fixture CSS agree in
 * both directions, which only means something if the list is authored.
 *
 * `proton`'s `searchbox.png` is intentionally absent — it ships in the stellar-ui
 * bundle but is referenced by nothing, and migrating dead weight would carry it
 * forward forever.
 */
export const BUILTIN_ASSET_FIXTURES: readonly BuiltinAssetFixture[] = [
  { theme: 'proton', file: 'what_bg.jpg', kind: 'ThemeImage' },
  { theme: 'proton', file: 'inputbg.png', kind: 'ThemeImage' },
  { theme: 'proton', file: 'footer_bg.png', kind: 'ThemeImage' }
] as const;

const SEED_ASSET_DIR = resolve(__dirname, '../../prisma/seed-assets/assets');

/** Read a shipped theme binary off disk (under prisma/, shipped in the image). */
export const readFixtureAsset = (theme: string, file: string): Buffer =>
  readFileSync(resolve(SEED_ASSET_DIR, theme, file));

/**
 * Load every shipped theme binary into the asset store.
 *
 * Idempotent by content: `putAsset` returns the existing row when the bytes are
 * already stored, so this is safe on every container boot. Site-owned, so no
 * `ownerId` — these belong to the install, not to the reserved System user that
 * owns the stylesheet rows (ADR-0026: asset ownership is about write
 * authorization, and nothing may overwrite a built-in).
 */
export async function seedAssetFixtures(client: PrismaClient): Promise<void> {
  for (const fixture of BUILTIN_ASSET_FIXTURES) {
    await putAsset(
      {
        data: readFixtureAsset(fixture.theme, fixture.file),
        kind: fixture.kind
      },
      client
    );
  }
}
