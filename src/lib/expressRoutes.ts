// Route-table introspection for the OpenAPI completeness gate (#474).
//
// Reads the routes an Express app ACTUALLY serves, by walking the router stack,
// rather than parsing `router.get('/x')` calls out of the source. Static parsing
// was the first cut in #474 and it works, but it is a second implementation of
// Express's mounting rules that has to be kept in step with the real one: it has
// to re-derive nested `router.use()` prefixes, and it silently misses anything
// registered anywhere but a literal call it recognises. Walking the built app
// cannot disagree with the app.
//
// The cost is a dependency on Express 4 internals (`_router`, `layer.regexp`,
// `layer.keys`), which are not public API. That is deliberate and contained:
// it lives in this one file, and expressRoutes.spec.ts pins the behaviour
// against a synthetic app, so an Express upgrade that changes the internals
// fails a unit test here rather than silently reporting zero routes.

import type { Express } from 'express';

import type { Operation } from './openapiCompleteness';

interface RouteLayer {
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
  };
  handle?: { stack?: RouteLayer[] };
  regexp?: RegExp & { fast_slash?: boolean };
  keys?: { name: string | number }[];
}

/**
 * Recover the mount prefix a layer contributes.
 *
 * Express 4 compiles `app.use('/api/users', r)` to `/^\/api\/users\/?(?=\/|$)/i`
 * and `app.use('/api/communities/:communityId/dnc', r)` to
 * `/^\/api\/communities(?:\/([^/]+?))\/dnc\/?(?=\/|$)/i`.
 *
 * Note the param group spells the slash INSIDE itself and leaves `[^/]`
 * unescaped — consume the whole group including that slash, or the rebuilt
 * prefix gains a doubled one. Getting this subtly wrong yields paths carrying
 * raw regex fragments, which then read as "unregistered" and inflate the count;
 * expressRoutes.spec.ts pins exactly this case.
 */
const mountPrefix = (layer: RouteLayer): string => {
  const re = layer.regexp;
  if (!re || re.fast_slash) return '';

  let src = re.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\$$/, '');

  let i = 0;
  const keys = layer.keys ?? [];
  src = src.replace(
    /\(\?:\\\/\(\[\^\/\]\+\?\)\)/g,
    () => `/:${keys[i++]?.name ?? 'param'}`
  );

  // Unescape what the regexp escaped (`\/` -> `/`, `\.` -> `.`, …).
  return src.replace(/\\(.)/g, '$1');
};

/** `:id` -> `{id}`, and drop a trailing slash, matching how openapi.json writes paths. */
const toOpenApiPath = (path: string): string =>
  path.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/(.)\/$/, '$1');

/**
 * Every operation the app serves, as `{ method, path }` with `{param}`
 * placeholders. Methods are upper-cased; Express's internal `_all` is dropped.
 */
export const collectRoutes = (app: Express): Operation[] => {
  const found: Operation[] = [];

  const walk = (stack: RouteLayer[], base: string): void => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path)
          ? layer.route.path
          : [layer.route.path];
        for (const p of paths) {
          for (const [method, enabled] of Object.entries(layer.route.methods)) {
            if (!enabled || method === '_all') continue;
            found.push({
              method: method.toUpperCase(),
              path: toOpenApiPath(base + p)
            });
          }
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, base + mountPrefix(layer));
      }
    }
  };

  const router = (app as unknown as { _router?: { stack: RouteLayer[] } })
    ._router;
  if (!router?.stack) {
    throw new Error(
      'Could not read the Express route table (app._router is absent). This is an ' +
        'Express-internals dependency; see src/lib/expressRoutes.ts.'
    );
  }

  walk(router.stack, '');
  return found;
};
