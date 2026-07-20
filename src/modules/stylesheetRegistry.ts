/**
 * The site-registry delivery partition (ADR-0024 §4, #371).
 *
 * Every `Stylesheet` row is exactly one of two things:
 *
 *   - **`/css`-backed** — `cssUrl` names an `AuthorStylesheet` delivery target,
 *     and the stored row is canonical.
 *   - **null `cssUrl`** — the row has no delivery target. It appears in the
 *     picker and renders nothing (this is Sublime: the bundled Tailwind already
 *     *is* Sublime, so there is nothing to inject).
 *
 * Nothing else is legal. In particular a row may not point into stellar-ui's
 * retired `/stylesheets/…` static tree: ADR-0024 said "the stored row is
 * canonical, no silent duplicate" and nothing enforced it, so `anorex`, `kuro`
 * and `layer-cake` moved to api delivery while their ui static files kept
 * shipping to every user, referenced by nothing.
 *
 * Expressed as a **total** partition rather than a carve-out on purpose. The
 * nullable `cssUrl` is what makes that expressible without an exception list —
 * and an exception list is exactly where the next `proton` would hide. If you
 * find yourself wanting a `name !== 'sublime'` escape hatch here, the nullable
 * migration has not landed properly.
 *
 * Known seam, deliberately not oversold: this is **not** cross-repo. The api
 * cannot see stellar-ui's `src/stylesheets/` tree, so someone adding a static
 * theme directory without touching the api still fails silently here. The ui
 * half is its own exact-set guard (stellar-ui `stylesheetsDir.test.ts`, #167/#168).
 */

/**
 * The `/css` delivery route. Anchored at both ends: a value that merely
 * *contains* the route is not a delivery target, and treating it as one would
 * let the guard pass on a URL that 404s in delivery.
 */
export const CSS_DELIVERY_ROUTE =
  /^\/api\/stylesheet\/author-stylesheet\/(\d+)\/css$/;

/** The registry columns the partition is defined over. */
export interface RegistryDeliveryRow {
  name: string;
  cssUrl: string | null;
}

/**
 * The `AuthorStylesheet` id a delivery target names, or `null` when `cssUrl`
 * is not one (including the legal null-delivery case).
 */
export const authorStylesheetIdFromCssUrl = (
  cssUrl: string | null
): number | null => {
  if (cssUrl === null) return null;
  const match = CSS_DELIVERY_ROUTE.exec(cssUrl);
  return match ? Number(match[1]) : null;
};

/** True when the row sits in one of the two legal arms. */
export const isInDeliveryPartition = (row: RegistryDeliveryRow): boolean =>
  row.cssUrl === null || CSS_DELIVERY_ROUTE.test(row.cssUrl);

/**
 * Every row outside the partition. Returns *all* offenders rather than the
 * first, so a sweep reports the whole set instead of one row per CI run.
 */
export const rowsOutsideDeliveryPartition = <T extends RegistryDeliveryRow>(
  rows: T[]
): T[] => rows.filter((row) => !isInDeliveryPartition(row));
