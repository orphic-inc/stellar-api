import {
  authorStylesheetIdFromCssUrl,
  rowsOutsideDeliveryPartition
} from './stylesheetRegistry';

/*
 * The registry partition (ADR-0024 §4, #371). Every site-registry row is either
 * `/css`-backed or has a null `cssUrl` — nothing else is legal.
 *
 * These pin the predicate itself; stylesheetRegistry.integration.ts applies the
 * same predicate to real seeded rows. Kept pure so the illegal shapes can be
 * enumerated directly rather than round-tripped through a DB.
 */

const row = (name: string, cssUrl: string | null) => ({ name, cssUrl });

describe('registry delivery partition', () => {
  it('accepts a /css-backed row', () => {
    expect(
      rowsOutsideDeliveryPartition([
        row('kuro', '/api/stylesheet/author-stylesheet/7/css')
      ])
    ).toEqual([]);
  });

  it('accepts a null-cssUrl row — present in the picker, renders nothing', () => {
    expect(rowsOutsideDeliveryPartition([row('sublime', null)])).toEqual([]);
  });

  it('flags a row pointing at the retired ui static tree', () => {
    const bad = row('foo', '/stylesheets/foo/style.css');
    expect(rowsOutsideDeliveryPartition([row('sublime', null), bad])).toEqual([
      bad
    ]);
  });

  it('flags every illegal shape, not just the first', () => {
    // Reporting one row per run would make a sweep take as many CI runs as
    // there are offenders.
    const rows = [
      row('a', '/stylesheets/a/style.css'),
      row('b', 'https://cdn.example.com/b.css'),
      row('c', ''),
      row('ok', null)
    ];
    expect(rowsOutsideDeliveryPartition(rows).map((r) => r.name)).toEqual([
      'a',
      'b',
      'c'
    ]);
  });

  it('rejects near-misses of the delivery route', () => {
    // Anchored both ends: a value that merely CONTAINS the route, or omits the
    // id, would otherwise pass the guard while 404ing in delivery.
    const nearMisses = [
      '/api/stylesheet/author-stylesheet//css',
      '/api/stylesheet/author-stylesheet/abc/css',
      '/api/stylesheet/author-stylesheet/7/css/extra',
      'https://evil.test/api/stylesheet/author-stylesheet/7/css',
      '/api/stylesheet/author-stylesheet/7'
    ];
    for (const cssUrl of nearMisses) {
      expect(rowsOutsideDeliveryPartition([row('x', cssUrl)])).toHaveLength(1);
    }
  });

  it('extracts the AuthorStylesheet id from a delivery target', () => {
    expect(
      authorStylesheetIdFromCssUrl('/api/stylesheet/author-stylesheet/42/css')
    ).toBe(42);
    expect(authorStylesheetIdFromCssUrl(null)).toBeNull();
    expect(
      authorStylesheetIdFromCssUrl('/stylesheets/foo/style.css')
    ).toBeNull();
  });
});
