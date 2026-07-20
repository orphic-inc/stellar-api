/**
 * Drift guard for the built-in stylesheet fixtures. Pure (no DB): reads the
 * canonical `.css` off disk and proves each is conformant — passing the
 * store-time boundary, so it seeds without tripping the boot assertion, and
 * meeting the assertion for its kind: token-only fixtures define the full
 * `--st-*` primitive set (stellar-ui ADR-0005), asset-bearing ones are checked
 * against the shipped assets in the companion describe below (#341).
 *
 * **The safety assertion inverted here (#351).** This spec used to assert
 * `sanitizeStylesheetSource(css) === css` — under a *cleaning* sanitizer that
 * was a real guard, and it is how #340 was caught. Under ADR-0031 §5's verbatim
 * storage it is true by construction for every input, hostile ones included, so
 * carrying it across would have left a test that cannot fail. It is replaced by
 * a **conformance** assertion: the fixture must produce no violations. That one
 * can fail, and it fails in CI rather than at container boot.
 */
import { createHash } from 'crypto';
import { validateAsset } from '../lib/assetValidate';
import { cssValidate } from '../lib/cssValidate';
import { BUILTIN_ASSET_FIXTURES, readFixtureAsset } from './assetFixtures';
import {
  BUILTIN_STYLESHEET_FIXTURES,
  REQUIRED_ST_PRIMITIVES,
  missingStPrimitives,
  readFixtureCss
} from './stylesheetFixtures';

const cases: [string, string][] = BUILTIN_STYLESHEET_FIXTURES.map((f) => [
  f.name,
  f.file
]);

const tokenCases = cases.filter(
  ([name]) =>
    BUILTIN_STYLESHEET_FIXTURES.find((f) => f.name === name)!.kind === 'token'
);

/** Every `/api/asset/<hash>` a fixture references, in source order. */
const referencedHashes = (css: string): string[] =>
  Array.from(css.matchAll(/\/api\/asset\/([0-9a-f]{64})/g)).map((m) => m[1]);

const shippedHash = (theme: string, file: string): string =>
  createHash('sha256').update(readFixtureAsset(theme, file)).digest('hex');

describe('built-in stylesheet fixtures', () => {
  it('the required primitive list has no duplicates', () => {
    expect(new Set(REQUIRED_ST_PRIMITIVES).size).toBe(
      REQUIRED_ST_PRIMITIVES.length
    );
  });

  it.each(tokenCases)(
    '%s defines the full --st-* primitive set',
    (_name, file) => {
      expect(missingStPrimitives(readFixtureCss(file))).toEqual([]);
    }
  );

  it.each(cases)(
    '%s conforms to the store-time boundary, so it seeds without failing boot',
    (_name, file) => {
      expect(cssValidate(readFixtureCss(file))).toEqual([]);
    }
  );

  it('the conformance assertion can actually fail', () => {
    // Pins the guard itself. The assertion above is only evidence if a
    // non-conformant fixture would trip it — which is exactly what stopped
    // being true when the sanitizer became a detector that never writes.
    expect(
      cssValidate('@import url(https://evil.test/x.css);:root{--st-bg:#000}')
    ).not.toEqual([]);
  });
});

/**
 * Drift guard for the asset-bearing fixtures (#341). Checked in **both**
 * directions, because each catches a different mistake:
 *
 *   - forward — a referenced hash with no shipped bytes is a theme that seeds
 *     fine and renders with broken imagery, which nothing else would catch;
 *   - reverse — a shipped file nobody references is dead weight migrating
 *     forward forever (this is how `proton/searchbox.png` was caught and left
 *     behind in the ui bundle).
 *
 * The hashes are checked in pre-rewritten, so both directions are pure disk
 * reads with no DB and no seed run.
 */
describe('built-in asset fixtures', () => {
  const allReferenced = new Set(
    BUILTIN_STYLESHEET_FIXTURES.flatMap((f) =>
      referencedHashes(readFixtureCss(f.file))
    )
  );

  it.each(BUILTIN_ASSET_FIXTURES.map((a) => [a.theme, a.file]))(
    '%s/%s is referenced by a fixture at the hash of its actual bytes',
    (theme, file) => {
      expect(allReferenced).toContain(shippedHash(theme, file));
    }
  );

  it('every referenced /api/asset hash resolves to a shipped asset', () => {
    const shipped = new Set(
      BUILTIN_ASSET_FIXTURES.map((a) => shippedHash(a.theme, a.file))
    );
    const dangling = [...allReferenced].filter((h) => !shipped.has(h));
    expect(dangling).toEqual([]);
  });

  it.each(BUILTIN_ASSET_FIXTURES.map((a) => [a.theme, a.file]))(
    '%s/%s passes the store-time asset boundary, so seeding cannot fail at boot',
    (theme, file) => {
      // `putAsset` throws on an unrecognized or oversize payload, and the seed
      // runs on every container boot — so an unstorable shipped byte is a boot
      // failure, not a bad render. Catch it in CI instead.
      expect(() => validateAsset(readFixtureAsset(theme, file))).not.toThrow();
    }
  );

  it('token-only fixtures reference no assets', () => {
    // A token fixture that grew a url() has quietly changed kind, and would be
    // held to the wrong assertion above.
    for (const [name, file] of tokenCases) {
      expect({ name, refs: referencedHashes(readFixtureCss(file)) }).toEqual({
        name,
        refs: []
      });
    }
  });

  it('proton carries its escaped Tailwind selectors verbatim', () => {
    // The point of ADR-0031's verbatim storage, and the reason #340 is not on
    // this issue's path: `.bg-gray-900\/60` must survive as authored. A
    // decoded-and-persisted copy would read `.bg-gray-900/60` and match nothing.
    const css = readFixtureCss('proton.css');
    expect(css).toContain('.bg-gray-900\\/60');
    expect(cssValidate(css)).toEqual([]);
  });
});
