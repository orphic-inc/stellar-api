/**
 * Drift guard for the built-in stylesheet fixtures. Pure (no DB): reads the
 * canonical `.css` off disk and proves each is a conformant token-only theme —
 * defines the full `--st-*` primitive set (stellar-ui ADR-0005) and survives the
 * store-time sanitizer unchanged, so `/css` delivery is verbatim. A theme that
 * drops a primitive or sneaks in an unsafe `url()`/`@import` fails here in CI
 * rather than shipping as a half-painted or mutated fixture.
 */
import { sanitizeStylesheetSource } from '../lib/cssSanitize';
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
    '%s is /css-safe: the store-time sanitizer is a no-op',
    (_name, file) => {
      const css = readFixtureCss(file);
      // No sheet-pulling at-rules on a token-only theme.
      expect(css).not.toMatch(/@import|@charset|@namespace/);
      // Verbatim delivery: sanitizing the stored source must not change a byte.
      expect(sanitizeStylesheetSource(css)).toBe(css);
    }
  );
});
