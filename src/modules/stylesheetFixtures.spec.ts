/**
 * Drift guard for the built-in stylesheet fixtures. Pure (no DB): reads the
 * canonical `.css` off disk and proves each is a conformant token-only theme —
 * defines the full `--st-*` primitive set (stellar-ui ADR-0005) and passes the
 * store-time boundary, so it can be seeded without tripping the boot assertion.
 *
 * **The safety assertion inverted here (#351).** This spec used to assert
 * `sanitizeStylesheetSource(css) === css` — under a *cleaning* sanitizer that
 * was a real guard, and it is how #340 was caught. Under ADR-0031 §5's verbatim
 * storage it is true by construction for every input, hostile ones included, so
 * carrying it across would have left a test that cannot fail. It is replaced by
 * a **conformance** assertion: the fixture must produce no violations. That one
 * can fail, and it fails in CI rather than at container boot.
 */
import { cssValidate } from '../lib/cssValidate';
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

describe('built-in stylesheet fixtures', () => {
  it('the required primitive list has no duplicates', () => {
    expect(new Set(REQUIRED_ST_PRIMITIVES).size).toBe(
      REQUIRED_ST_PRIMITIVES.length
    );
  });

  it.each(cases)('%s defines the full --st-* primitive set', (_name, file) => {
    expect(missingStPrimitives(readFixtureCss(file))).toEqual([]);
  });

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
